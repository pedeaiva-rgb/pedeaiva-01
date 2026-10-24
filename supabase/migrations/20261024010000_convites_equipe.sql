-- Equipe por link de convite: a pessoa se cadastra pelo link da loja, o dono aprova e escolhe a função.
-- Rode depois de 20261024000000_funcao_atendente.sql.

-- "convite" é rota do sistema: não pode virar endereço de loja.
alter table public.pizzerias add constraint pizzerias_slug_reservado check (slug not in ('convite'));

-- ============ CPF ============
create or replace function public.valid_cpf(_cpf text)
returns boolean language plpgsql immutable set search_path = public as $$
declare d text := coalesce(_cpf, ''); s int; r int; i int;
begin
  if d !~ '^[0-9]{11}$' or d ~ '^(.)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

-- ============ LINK DE CONVITE ============
create table public.team_invites (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ============ PEDIDOS DE ACESSO ============
create type public.join_status as enum ('pendente', 'aprovado', 'recusado');

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 3 and 80),
  email text not null,
  cpf text not null check (public.valid_cpf(cpf)),
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  status public.join_status not null default 'pendente',
  role public.member_role,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  unique (pizzeria_id, user_id)
);
create index join_requests_status_idx on public.join_requests (pizzeria_id, status, created_at desc);

-- Entregador com login: liga o cadastro de entregadores à conta da pessoa.
alter table public.couriers add column user_id uuid references auth.users (id) on delete set null;
create unique index couriers_user_idx on public.couriers (pizzeria_id, user_id) where user_id is not null;

-- ============ FUNÇÕES ============
-- Link atual da loja (cria na primeira vez). Só o dono.
create or replace function public.team_invite(_pz uuid)
returns table (code text, active boolean) language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.team_invites (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  return query select t.code, t.active from public.team_invites t where t.pizzeria_id = _pz;
end $$;

-- Gera um link novo: o antigo para de funcionar.
create or replace function public.reset_team_invite(_pz uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.team_invites (pizzeria_id, code) values (_pz, c)
  on conflict (pizzeria_id) do update set code = excluded.code, active = true, updated_at = now();
  return c;
end $$;

create or replace function public.set_team_invite_active(_pz uuid, _active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.team_invites set active = _active, updated_at = now() where pizzeria_id = _pz;
end $$;

-- O que a página do convite mostra (aberta a qualquer pessoa com o link).
create or replace function public.invite_info(_code text)
returns table (pizzeria_name text, pizzeria_slug text) language sql stable security definer set search_path = public as $$
  select z.name, z.slug from public.team_invites t join public.pizzerias z on z.id = t.pizzeria_id
  where t.code = _code and t.active
$$;

-- A pessoa logada pede acesso pela página do convite.
create or replace function public.request_join(_code text, _name text, _cpf text, _phone text)
returns text language plpgsql security definer set search_path = public as $$
declare inv record; v_phone text := public.normalize_br_phone(_phone); v_cpf text := regexp_replace(coalesce(_cpf, ''), '[^0-9]', '', 'g'); v_email text;
begin
  if auth.uid() is null then raise exception 'Faça login para pedir acesso' using errcode = '42501'; end if;
  select t.pizzeria_id, z.name into inv from public.team_invites t join public.pizzerias z on z.id = t.pizzeria_id
  where t.code = _code and t.active;
  if not found then raise exception 'Este link de convite não vale mais. Peça um link novo para a pizzaria.' using errcode = '22023'; end if;
  if public.is_member(inv.pizzeria_id) then raise exception 'Você já faz parte da equipe desta pizzaria.' using errcode = '22023'; end if;
  if length(btrim(coalesce(_name, ''))) < 3 then raise exception 'Informe seu nome completo' using errcode = '22023'; end if;
  if not public.valid_cpf(v_cpf) then raise exception 'CPF inválido' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'Telefone inválido: informe DDD + número' using errcode = '22023'; end if;
  if (select count(*) from public.join_requests where pizzeria_id = inv.pizzeria_id and status = 'pendente') >= 30 then
    raise exception 'Esta pizzaria já tem muitos pedidos aguardando. Avise o responsável.' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.join_requests (pizzeria_id, user_id, full_name, email, cpf, phone)
  values (inv.pizzeria_id, auth.uid(), left(btrim(_name), 80), coalesce(v_email, ''), v_cpf, v_phone)
  on conflict (pizzeria_id, user_id) do update set
    full_name = excluded.full_name, email = excluded.email, cpf = excluded.cpf, phone = excluded.phone,
    status = 'pendente', role = null, created_at = now(), decided_at = null, decided_by = null;
  return inv.name;
end $$;

-- O dono aprova e escolhe a função (dono só se promove depois, pela lista da equipe).
create or replace function public.approve_join(_request uuid, _role public.member_role)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.join_requests where id = _request for update;
  if not found or not public.has_role(r.pizzeria_id, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _role = 'owner' then raise exception 'Escolha uma função da equipe' using errcode = '22023'; end if;
  if r.status <> 'pendente' then raise exception 'Este pedido já foi respondido' using errcode = '22023'; end if;
  update public.join_requests set status = 'aprovado', role = _role, decided_at = now(), decided_by = auth.uid() where id = _request;
  insert into public.members (pizzeria_id, user_id, role, display_name)
  values (r.pizzeria_id, r.user_id, _role, r.full_name)
  on conflict (pizzeria_id, user_id) do update set role = excluded.role, display_name = excluded.display_name;
end $$;

create or replace function public.reject_join(_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.join_requests where id = _request for update;
  if not found or not public.has_role(r.pizzeria_id, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if r.status <> 'pendente' then raise exception 'Este pedido já foi respondido' using errcode = '22023'; end if;
  update public.join_requests set status = 'recusado', decided_at = now(), decided_by = auth.uid() where id = _request;
end $$;

-- Quem vira entregador entra sozinho na lista de entregadores; quem deixa de ser fica desativado.
create or replace function public.sync_member_courier()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'driver' then
    update public.couriers set active = true where pizzeria_id = new.pizzeria_id and user_id = new.user_id;
    if not found then
      select jr.full_name, jr.phone into v_name, v_phone from public.join_requests jr
      where jr.pizzeria_id = new.pizzeria_id and jr.user_id = new.user_id;
      v_name := coalesce(nullif(btrim(new.display_name), ''), v_name,
        (select split_part(email, '@', 1) from auth.users where id = new.user_id), 'Entregador');
      insert into public.couriers (pizzeria_id, name, phone, user_id)
      values (new.pizzeria_id, left(v_name, 60), v_phone, new.user_id);
    end if;
  end if;
  if (tg_op = 'UPDATE' and old.role = 'driver' and new.role <> 'driver') or (tg_op = 'DELETE' and old.role = 'driver') then
    update public.couriers set active = false where pizzeria_id = old.pizzeria_id and user_id = old.user_id;
  end if;
  return null;
end $$;
create trigger members_sync_courier after insert or update of role or delete on public.members
  for each row execute function public.sync_member_courier();

-- ============ ATENDENTE NAS REGRAS DE PEDIDO ============
create or replace function public.roles_for_transition(_to public.order_status)
returns public.member_role[] language sql immutable as $$
  select case _to
    when 'confirmado' then '{owner,manager,cashier,attendant}'::public.member_role[]
    when 'preparo' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'pronto' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'saiu' then '{owner,manager,cashier,attendant,driver}'::public.member_role[]
    when 'entregue' then '{owner,manager,cashier,attendant,driver}'::public.member_role[]
    when 'cancelado' then '{owner,manager,cashier,attendant}'::public.member_role[]
    else '{}'::public.member_role[]
  end
$$;

create or replace function public.assign_courier(_order uuid, _courier uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record; c record;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, '{owner,manager,cashier,attendant}') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if o.fulfillment <> 'entrega' then raise exception 'Pedido de retirada não tem entregador' using errcode = '22023'; end if;
  if o.status in ('entregue', 'cancelado') then raise exception 'Este pedido já foi finalizado' using errcode = '22023'; end if;
  if _courier is not null then
    select * into c from public.couriers where id = _courier and pizzeria_id = o.pizzeria_id;
    if not found then raise exception 'Entregador não encontrado' using errcode = '22023'; end if;
    if not c.active then raise exception 'Este entregador está desativado' using errcode = '22023'; end if;
  end if;
  if o.courier_id is not distinct from _courier then return; end if;
  update public.orders set courier_id = _courier, updated_at = now() where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, o.status, auth.uid(),
          case when _courier is null then 'Entregador removido' else 'Entregador: ' || c.name end);
end $$;

drop policy "equipe ve clientes" on public.customers;
create policy "equipe ve clientes" on public.customers for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant,driver}'));

-- ============ PERMISSÕES ============
alter table public.team_invites enable row level security;
alter table public.join_requests enable row level security;
grant select on public.team_invites, public.join_requests to authenticated;
grant all on public.team_invites, public.join_requests to service_role;
create policy "dono ve convite" on public.team_invites for select to authenticated using (public.has_role(pizzeria_id, '{owner}'));
create policy "dono e a propria pessoa veem pedidos" on public.join_requests for select to authenticated
  using (user_id = auth.uid() or public.has_role(pizzeria_id, '{owner}'));

revoke execute on function public.team_invite(uuid), public.reset_team_invite(uuid), public.set_team_invite_active(uuid, boolean),
  public.invite_info(text), public.request_join(text, text, text, text), public.approve_join(uuid, public.member_role),
  public.reject_join(uuid), public.sync_member_courier() from public, anon;
grant execute on function public.valid_cpf(text) to anon, authenticated, service_role;
grant execute on function public.invite_info(text) to anon, authenticated, service_role;
grant execute on function public.team_invite(uuid), public.reset_team_invite(uuid), public.set_team_invite_active(uuid, boolean),
  public.request_join(text, text, text, text), public.approve_join(uuid, public.member_role), public.reject_join(uuid) to authenticated;
