-- Tela da cozinha por link (sem login): o tablet/TV da cozinha abre um link fixo da loja, com PIN opcional.
-- Pelo link a cozinha só vê os itens a preparar e marca "no forno" e "pronto". Trocar o link derruba os aparelhos.

alter table public.pizzerias drop constraint pizzerias_slug_reservado;
alter table public.pizzerias add constraint pizzerias_slug_reservado check (slug not in ('convite', 'cozinha'));

create table public.kitchen_links (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  pin_hash text,
  active boolean not null default true,
  pin_failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Cada tablet/TV que entrou pelo link recebe uma chave própria (fica guardada só nele).
create table public.kitchen_devices (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index kitchen_devices_pz_idx on public.kitchen_devices (pizzeria_id);

alter table public.kitchen_links enable row level security;
alter table public.kitchen_devices enable row level security;
revoke all on public.kitchen_links, public.kitchen_devices from anon, authenticated;
grant all on public.kitchen_links, public.kitchen_devices to service_role;

create or replace function public.kitchen_pin_hash(_pz uuid, _pin text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(_pz::text || ':' || _pin, 'UTF8')), 'hex')
$$;

-- ============ LOJA (dono e gerente) ============
create or replace function public.kitchen_link(_pz uuid)
returns table (code text, active boolean, has_pin boolean, devices integer) language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.kitchen_links (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  return query
    select k.code, k.active, k.pin_hash is not null,
           (select count(*)::int from public.kitchen_devices d where d.pizzeria_id = _pz and d.last_seen_at > now() - interval '2 minutes')
    from public.kitchen_links k where k.pizzeria_id = _pz;
end $$;

-- Link novo: o antigo para de funcionar e todos os aparelhos saem.
create or replace function public.reset_kitchen_link(_pz uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.kitchen_links (pizzeria_id, code) values (_pz, c)
  on conflict (pizzeria_id) do update set code = excluded.code, active = true, pin_failures = 0, locked_until = null, updated_at = now();
  delete from public.kitchen_devices where pizzeria_id = _pz;
  return c;
end $$;

-- PIN de 4 números (vazio = sem PIN). Mudar o PIN pede o PIN de novo em todos os aparelhos.
create or replace function public.set_kitchen_pin(_pz uuid, _pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _pin is not null and _pin !~ '^[0-9]{4}$' then raise exception 'O PIN tem 4 números' using errcode = '22023'; end if;
  insert into public.kitchen_links (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  update public.kitchen_links set pin_hash = case when _pin is null then null else public.kitchen_pin_hash(_pz, _pin) end,
    pin_failures = 0, locked_until = null, updated_at = now() where pizzeria_id = _pz;
  delete from public.kitchen_devices where pizzeria_id = _pz;
end $$;

create or replace function public.set_kitchen_link_active(_pz uuid, _active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.kitchen_links set active = _active, updated_at = now() where pizzeria_id = _pz;
  if not _active then delete from public.kitchen_devices where pizzeria_id = _pz; end if;
end $$;

-- ============ APARELHO DA COZINHA (sem login) ============
-- Abre o link: devolve a chave do aparelho, ou pede o PIN. 5 PINs errados travam por 10 minutos.
create or replace function public.kitchen_open(_code text, _pin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k record; tok text; z record;
begin
  select * into k from public.kitchen_links where code = _code and active for update;
  if not found then return jsonb_build_object('error', 'Este link da cozinha não vale mais. Peça o link novo ao responsável.'); end if;
  select name, prep_minutes into z from public.pizzerias where id = k.pizzeria_id;
  if k.pin_hash is not null then
    if k.locked_until is not null and k.locked_until > now() then
      return jsonb_build_object('error', 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.', 'needs_pin', true, 'pizzeria', z.name);
    end if;
    if _pin is null then return jsonb_build_object('needs_pin', true, 'pizzeria', z.name); end if;
    if public.kitchen_pin_hash(k.pizzeria_id, _pin) <> k.pin_hash then
      update public.kitchen_links set pin_failures = case when pin_failures + 1 >= 5 then 0 else pin_failures + 1 end,
        locked_until = case when pin_failures + 1 >= 5 then now() + interval '10 minutes' else locked_until end
      where pizzeria_id = k.pizzeria_id;
      return jsonb_build_object('error', 'PIN errado.', 'needs_pin', true, 'pizzeria', z.name);
    end if;
    update public.kitchen_links set pin_failures = 0, locked_until = null where pizzeria_id = k.pizzeria_id;
  end if;
  insert into public.kitchen_devices (pizzeria_id) values (k.pizzeria_id) returning token into tok;
  return jsonb_build_object('token', tok, 'pizzeria', z.name, 'prep_minutes', z.prep_minutes);
end $$;

-- Pedidos para preparar (só o que vai no forno: nada de cliente, telefone, endereço ou valores).
create or replace function public.kitchen_tickets(_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pz uuid;
begin
  update public.kitchen_devices set last_seen_at = now() where token = _device returning pizzeria_id into pz;
  if pz is null then return jsonb_build_object('error', 'expirado'); end if;
  return jsonb_build_object(
    'pizzeria', (select name from public.pizzerias where id = pz),
    'prep_minutes', (select prep_minutes from public.pizzerias where id = pz),
    'waiting', (select count(*)::int from public.orders where pizzeria_id = pz and status = 'novo' and created_at > now() - interval '24 hours'),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'number', o.number, 'status', o.status, 'fulfillment', o.fulfillment, 'notes', o.notes,
        'created_at', o.created_at, 'updated_at', o.updated_at,
        'order_items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'size_name', i.size_name, 'flavors', i.flavors,
                                   'extras', i.extras, 'note', i.note, 'qty', i.qty) order by i.id)
                                 from public.order_items i where i.order_id = o.id), '[]'::jsonb)) order by o.created_at)
      from public.orders o
      where o.pizzeria_id = pz and o.status in ('confirmado', 'preparo', 'pronto') and o.created_at > now() - interval '24 hours'), '[]'::jsonb));
end $$;

-- A cozinha marca "no forno" e "pronto" (e só isso).
create or replace function public.kitchen_move(_device text, _order uuid, _to public.order_status)
returns void language plpgsql security definer set search_path = public as $$
declare pz uuid; o record;
begin
  select pizzeria_id into pz from public.kitchen_devices where token = _device;
  if pz is null then raise exception 'Aparelho desconectado. Abra o link da cozinha de novo.' using errcode = '42501'; end if;
  if _to not in ('preparo', 'pronto') then raise exception 'A cozinha só marca preparo e pronto' using errcode = '42501'; end if;
  select * into o from public.orders where id = _order and pizzeria_id = pz for update;
  if not found then raise exception 'Pedido não encontrado' using errcode = '22023'; end if;
  if o.status = _to then return; end if;
  if not public.allowed_transition(o.fulfillment, o.status, _to) then
    raise exception 'Não é possível passar de % para %', o.status, _to using errcode = '22023';
  end if;
  update public.orders set status = _to, updated_at = now() where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (pz, _order, o.status, _to, null, 'Tela da cozinha');
  update public.kitchen_devices set last_seen_at = now() where token = _device;
end $$;

revoke execute on function public.kitchen_pin_hash(uuid, text), public.kitchen_link(uuid), public.reset_kitchen_link(uuid),
  public.set_kitchen_pin(uuid, text), public.set_kitchen_link_active(uuid, boolean), public.kitchen_open(text, text),
  public.kitchen_tickets(text), public.kitchen_move(text, uuid, public.order_status) from public;
grant execute on function public.kitchen_link(uuid), public.reset_kitchen_link(uuid), public.set_kitchen_pin(uuid, text),
  public.set_kitchen_link_active(uuid, boolean) to authenticated;
grant execute on function public.kitchen_open(text, text), public.kitchen_tickets(text), public.kitchen_move(text, uuid, public.order_status)
  to anon, authenticated;
