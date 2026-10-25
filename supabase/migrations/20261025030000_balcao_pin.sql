-- Modo balcão e senha de autorização.
-- Cada pessoa da equipe tem um PIN de 4 números. No computador do balcão (link da loja) ela toca no nome
-- e digita o PIN para entrar. O PIN de gerente/dono também autoriza cancelamento e estorno feitos pelo caixa/atendente.

alter table public.pizzerias drop constraint pizzerias_slug_reservado;
alter table public.pizzerias add constraint pizzerias_slug_reservado check (slug not in ('convite', 'cozinha', 'balcao'));

create table public.member_pins (
  pizzeria_id uuid not null,
  user_id uuid not null,
  pin_hash text not null,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (pizzeria_id, user_id),
  foreign key (pizzeria_id, user_id) references public.members (pizzeria_id, user_id) on delete cascade
);

create table public.counter_links (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  active boolean not null default true,
  idle_minutes integer not null default 10 check (idle_minutes between 2 and 240),
  updated_at timestamptz not null default now()
);

create table public.counter_devices (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index counter_devices_pz_idx on public.counter_devices (pizzeria_id);

-- Autorização de gerente: vale uma vez, para um pedido e uma ação, por 5 minutos.
create table public.manager_approvals (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  order_id uuid not null,
  action text not null check (action in ('cancelar', 'estornar')),
  requested_by uuid not null,
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index manager_approvals_idx on public.manager_approvals (order_id, action, requested_by);

-- Tentativas erradas do PIN de autorização (por loja): 5 erros travam 10 minutos.
create table public.approval_guard (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  failures integer not null default 0,
  locked_until timestamptz
);

alter table public.member_pins enable row level security;
alter table public.counter_links enable row level security;
alter table public.counter_devices enable row level security;
alter table public.manager_approvals enable row level security;
alter table public.approval_guard enable row level security;
revoke all on public.member_pins, public.counter_links, public.counter_devices, public.manager_approvals, public.approval_guard from anon, authenticated;
grant all on public.member_pins, public.counter_links, public.counter_devices, public.manager_approvals, public.approval_guard to service_role;

create or replace function public.member_pin_hash(_pz uuid, _user uuid, _pin text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(_pz::text || ':' || _user::text || ':' || _pin, 'UTF8')), 'hex')
$$;

-- ============ MEU PIN ============
create or replace function public.set_my_pin(_pz uuid, _pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(_pz) then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _pin is null or _pin !~ '^[0-9]{4}$' then raise exception 'O PIN tem 4 números' using errcode = '22023'; end if;
  if _pin in ('0000', '1111', '1234', '4321', '2222', '9999') then raise exception 'Escolha um PIN menos óbvio' using errcode = '22023'; end if;
  insert into public.member_pins (pizzeria_id, user_id, pin_hash) values (_pz, auth.uid(), public.member_pin_hash(_pz, auth.uid(), _pin))
  on conflict (pizzeria_id, user_id) do update set pin_hash = excluded.pin_hash, failures = 0, locked_until = null, updated_at = now();
end $$;

create or replace function public.my_pin_status(_pz uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member_pins where pizzeria_id = _pz and user_id = auth.uid())
$$;

-- Dono vê quem já tem PIN e pode zerar o de alguém (a pessoa cria outro).
create or replace function public.team_pins(_pz uuid)
returns table (user_id uuid, has_pin boolean) language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return query select m.user_id, exists (select 1 from public.member_pins p where p.pizzeria_id = _pz and p.user_id = m.user_id)
    from public.members m where m.pizzeria_id = _pz;
end $$;

create or replace function public.clear_member_pin(_pz uuid, _user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  delete from public.member_pins where pizzeria_id = _pz and user_id = _user;
end $$;

-- ============ LINK DO BALCÃO (dono e gerente) ============
create or replace function public.counter_link(_pz uuid)
returns table (code text, active boolean, idle_minutes integer, devices integer) language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.counter_links (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  return query
    select k.code, k.active, k.idle_minutes,
           (select count(*)::int from public.counter_devices d where d.pizzeria_id = _pz and d.last_seen_at > now() - interval '1 day')
    from public.counter_links k where k.pizzeria_id = _pz;
end $$;

create or replace function public.reset_counter_link(_pz uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.counter_links (pizzeria_id, code) values (_pz, c)
  on conflict (pizzeria_id) do update set code = excluded.code, active = true, updated_at = now();
  delete from public.counter_devices where pizzeria_id = _pz;
  return c;
end $$;

create or replace function public.set_counter_link(_pz uuid, _active boolean, _idle_minutes integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.counter_links set active = _active, idle_minutes = _idle_minutes, updated_at = now() where pizzeria_id = _pz;
  if not _active then delete from public.counter_devices where pizzeria_id = _pz; end if;
end $$;

-- ============ COMPUTADOR DO BALCÃO (sem login) ============
create or replace function public.counter_open(_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k record; tok text;
begin
  select * into k from public.counter_links where code = _code and active;
  if not found then return jsonb_build_object('error', 'Este link do balcão não vale mais. Peça o link novo ao responsável.'); end if;
  insert into public.counter_devices (pizzeria_id) values (k.pizzeria_id) returning token into tok;
  return jsonb_build_object('token', tok, 'pizzeria', (select name from public.pizzerias where id = k.pizzeria_id));
end $$;

-- Quem pode entrar por este balcão: equipe (menos cozinha e entregador) que já criou o PIN.
create or replace function public.counter_staff(_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pz uuid;
begin
  update public.counter_devices d set last_seen_at = now()
  from public.counter_links k
  where d.token = _device and k.pizzeria_id = d.pizzeria_id and k.active
  returning d.pizzeria_id into pz;
  if pz is null then return jsonb_build_object('error', 'expirado'); end if;
  return jsonb_build_object(
    'pizzeria', (select name from public.pizzerias where id = pz),
    'idle_minutes', (select idle_minutes from public.counter_links where pizzeria_id = pz),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(m.display_name, split_part(u.email, '@', 1)), 'role', m.role)
                       order by coalesce(m.display_name, u.email))
      from public.members m join public.member_pins p on p.pizzeria_id = m.pizzeria_id and p.user_id = m.user_id
      join auth.users u on u.id = m.user_id
      where m.pizzeria_id = pz and m.role in ('owner', 'manager', 'cashier', 'attendant')), '[]'::jsonb));
end $$;

-- Confere o PIN de quem vai entrar (chamado só pelo servidor, que então abre a sessão da pessoa).
-- 5 PINs errados travam aquela pessoa por 10 minutos.
create or replace function public.counter_check_pin(_device text, _user uuid, _pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pz uuid; p record; idle integer;
begin
  select d.pizzeria_id, k.idle_minutes into pz, idle from public.counter_devices d join public.counter_links k on k.pizzeria_id = d.pizzeria_id
  where d.token = _device and k.active;
  if pz is null then return jsonb_build_object('error', 'Este computador saiu do modo balcão. Abra o link do balcão de novo.'); end if;
  select * into p from public.member_pins where pizzeria_id = pz and user_id = _user for update;
  if not found or not exists (select 1 from public.members where pizzeria_id = pz and user_id = _user and role in ('owner', 'manager', 'cashier', 'attendant')) then
    return jsonb_build_object('error', 'Esta pessoa não pode entrar pelo balcão.');
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('error', 'Muitas tentativas erradas. Espere alguns minutos.');
  end if;
  if public.member_pin_hash(pz, _user, coalesce(_pin, '')) <> p.pin_hash then
    update public.member_pins set
      failures = case when failures + 1 >= 5 then 0 else failures + 1 end,
      locked_until = case when failures + 1 >= 5 then now() + interval '10 minutes' else locked_until end
    where pizzeria_id = pz and user_id = _user;
    return jsonb_build_object('error', 'PIN errado.');
  end if;
  update public.member_pins set failures = 0, locked_until = null where pizzeria_id = pz and user_id = _user;
  update public.counter_devices set last_seen_at = now() where token = _device;
  return jsonb_build_object('ok', true, 'pizzeria_id', pz, 'idle_minutes', idle);
end $$;

-- ============ AUTORIZAÇÃO DO GERENTE ============
-- Caixa/atendente pede: o gerente (ou dono) digita o PIN dele na mesma tela.
create or replace function public.request_approval(_order uuid, _action text, _pin text)
returns text language plpgsql security definer set search_path = public as $$
declare o record; g record; who record;
begin
  select id, pizzeria_id into o from public.orders where id = _order;
  if not found or not public.is_member(o.pizzeria_id) then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _action not in ('cancelar', 'estornar') then raise exception 'Ação inválida' using errcode = '22023'; end if;
  insert into public.approval_guard (pizzeria_id) values (o.pizzeria_id) on conflict (pizzeria_id) do nothing;
  select * into g from public.approval_guard where pizzeria_id = o.pizzeria_id for update;
  if g.locked_until is not null and g.locked_until > now() then
    raise exception 'Muitas tentativas erradas. Espere alguns minutos.' using errcode = '22023';
  end if;
  select m.user_id, coalesce(m.display_name, split_part(u.email, '@', 1)) as name into who
  from public.members m join public.member_pins p on p.pizzeria_id = m.pizzeria_id and p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.pizzeria_id = o.pizzeria_id and m.role in ('owner', 'manager')
    and p.pin_hash = public.member_pin_hash(o.pizzeria_id, m.user_id, coalesce(_pin, ''))
  limit 1;
  if not found then
    update public.approval_guard set
      failures = case when failures + 1 >= 5 then 0 else failures + 1 end,
      locked_until = case when failures + 1 >= 5 then now() + interval '10 minutes' else locked_until end
    where pizzeria_id = o.pizzeria_id;
    raise exception 'PIN de gerente errado.' using errcode = '22023';
  end if;
  update public.approval_guard set failures = 0, locked_until = null where pizzeria_id = o.pizzeria_id;
  insert into public.manager_approvals (pizzeria_id, order_id, action, requested_by, approved_by)
  values (o.pizzeria_id, _order, _action, auth.uid(), who.user_id);
  return who.name;
end $$;

-- Usa (uma vez) a autorização pendente; devolve o nome de quem autorizou.
create or replace function public.consume_approval(_order uuid, _action text)
returns text language plpgsql security definer set search_path = public as $$
declare a record; nm text;
begin
  select * into a from public.manager_approvals
  where order_id = _order and action = _action and requested_by = auth.uid() and used_at is null and created_at > now() - interval '5 minutes'
  order by created_at desc limit 1 for update;
  if not found then return null; end if;
  update public.manager_approvals set used_at = now() where id = a.id;
  select coalesce(m.display_name, split_part(u.email, '@', 1)) into nm from public.members m join auth.users u on u.id = m.user_id
  where m.pizzeria_id = a.pizzeria_id and m.user_id = a.approved_by;
  return coalesce(nm, 'gerente');
end $$;

-- Cancelar: caixa e atendente precisam da autorização do gerente (dono e gerente cancelam direto).
create or replace function public.transition_order(_order uuid, _to public.order_status, _note text default null)
returns public.order_status language plpgsql security definer set search_path = public as $$
declare o record; v_note text := nullif(left(btrim(coalesce(_note, '')), 300), ''); approver text;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, public.roles_for_transition(_to)) then
    raise exception 'Sem permissão para esta ação' using errcode = '42501';
  end if;
  if public.has_role(o.pizzeria_id, '{driver}') then
    if o.courier_id is null or o.courier_id is distinct from public.my_courier_id(o.pizzeria_id) then
      raise exception 'Este pedido não está com você' using errcode = '42501';
    end if;
    if _to = 'entregue' and coalesce(current_setting('pav.codigo_ok', true), '') <> '1'
       and (select require_delivery_code from public.pizzerias where id = o.pizzeria_id) then
      raise exception 'Peça o código de entrega ao cliente' using errcode = '22023';
    end if;
  end if;
  if o.status = _to then return o.status; end if;
  if not public.allowed_transition(o.fulfillment, o.status, _to) then
    raise exception 'Não é possível passar de % para %', o.status, _to using errcode = '22023';
  end if;
  if _to = 'cancelado' and length(btrim(coalesce(_note, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento' using errcode = '22023';
  end if;
  if _to = 'cancelado' and public.has_role(o.pizzeria_id, '{cashier,attendant}') then
    approver := public.consume_approval(_order, 'cancelar');
    if approver is null then raise exception 'Cancelamento precisa do PIN do gerente' using errcode = '42501'; end if;
    v_note := left(v_note || ' · autorizado por ' || approver, 300);
  end if;
  update public.orders set
    status = _to,
    updated_at = now(),
    dispatched_at = case when _to = 'saiu' then now() else dispatched_at end,
    delivered_at = case when _to = 'entregue' then now() else delivered_at end
  where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, _to, auth.uid(), v_note);
  return _to;
end $$;

-- Estornar: dono e gerente direto; caixa com a autorização do gerente.
create or replace function public.refund_payment(_order uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o record; rec record; v_note text := left(btrim(coalesce(_reason, '')), 300); approver text;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, '{owner,manager,cashier}') then
    raise exception 'Somente proprietário, gerente ou caixa (com autorização) pode estornar' using errcode = '42501';
  end if;
  if length(v_note) < 3 then raise exception 'Informe o motivo do estorno' using errcode = '22023'; end if;
  if public.has_role(o.pizzeria_id, '{cashier}') then
    approver := public.consume_approval(_order, 'estornar');
    if approver is null then raise exception 'Estorno precisa do PIN do gerente' using errcode = '42501'; end if;
    v_note := left(v_note || ' · autorizado por ' || approver, 300);
  end if;
  select * into rec from public.payments where order_id = _order and kind = 'recebimento';
  if not found then raise exception 'Não há recebimento para estornar' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where reverses_id = rec.id) then
    raise exception 'Este recebimento já foi estornado' using errcode = '22023';
  end if;
  insert into public.payments (pizzeria_id, order_id, kind, method, amount_cents, reverses_id, actor_id, note)
  values (o.pizzeria_id, _order, 'estorno', rec.method, rec.amount_cents, rec.id, auth.uid(), v_note);
  update public.orders set payment_status = 'estornado', updated_at = now() where id = _order;
end $$;

revoke execute on function public.member_pin_hash(uuid, uuid, text), public.set_my_pin(uuid, text), public.my_pin_status(uuid),
  public.team_pins(uuid), public.clear_member_pin(uuid, uuid), public.counter_link(uuid), public.reset_counter_link(uuid),
  public.set_counter_link(uuid, boolean, integer), public.counter_open(text), public.counter_staff(text),
  public.counter_check_pin(text, uuid, text), public.request_approval(uuid, text, text), public.consume_approval(uuid, text) from public;
grant execute on function public.set_my_pin(uuid, text), public.my_pin_status(uuid), public.team_pins(uuid), public.clear_member_pin(uuid, uuid),
  public.counter_link(uuid), public.reset_counter_link(uuid), public.set_counter_link(uuid, boolean, integer),
  public.request_approval(uuid, text, text) to authenticated;
grant execute on function public.counter_open(text), public.counter_staff(text) to anon, authenticated;
grant execute on function public.counter_check_pin(text, uuid, text) to service_role;
