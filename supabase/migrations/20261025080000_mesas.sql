-- Controle de mesas (parte 2). Rode depois de 20261025070000_mesas_enums.sql.
-- Mesa → conta (tab) aberta → rodadas (pedidos do canal "mesa", que vão para a cozinha) → pagamentos da conta → fechar.

alter table public.pizzerias drop constraint pizzerias_slug_reservado;
alter table public.pizzerias add constraint pizzerias_slug_reservado check (slug not in ('convite', 'cozinha', 'balcao', 'mesa'));
alter table public.pizzerias add column service_fee_pct numeric(4, 2) not null default 10 check (service_fee_pct between 0 and 30);
grant update (service_fee_pct) on public.pizzerias to authenticated;

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 20),
  area text not null default 'Salão' check (length(btrim(area)) between 1 and 30),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (pizzeria_id, name),
  unique (pizzeria_id, id)
);

create table public.tabs (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  table_id uuid not null,
  status text not null default 'aberta' check (status in ('aberta', 'fechada', 'cancelada')),
  guests integer check (guests is null or guests between 1 and 99),
  service_fee_pct numeric(4, 2) not null check (service_fee_pct between 0 and 30),
  service_note text check (service_note is null or length(service_note) <= 200),
  opened_by uuid,
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  merged_into uuid references public.tabs (id),
  unique (pizzeria_id, id),
  foreign key (pizzeria_id, table_id) references public.dining_tables (pizzeria_id, id)
);
-- Uma conta aberta por mesa.
create unique index tabs_one_open on public.tabs (table_id) where status = 'aberta';
create index tabs_pz_idx on public.tabs (pizzeria_id, opened_at desc);

-- Rodadas: pedidos ligados à conta da mesa.
alter table public.orders add column tab_id uuid;
alter table public.orders add constraint orders_tab_fk foreign key (pizzeria_id, tab_id) references public.tabs (pizzeria_id, id);
create index orders_tab_idx on public.orders (tab_id) where tab_id is not null;

-- Pagamentos da conta da mesa ficam na mesma tabela de pagamentos (entram no Caixa do dia).
alter table public.payments alter column order_id drop not null;
alter table public.payments add column tab_id uuid;
alter table public.payments add constraint payments_tab_fk foreign key (pizzeria_id, tab_id) references public.tabs (pizzeria_id, id);
alter table public.payments add constraint payments_order_or_tab check (order_id is not null or tab_id is not null);
alter table public.payments add column change_cents integer check (change_cents is null or change_cents >= 0);

-- Autorização do gerente também para tirar/baixar a taxa de serviço.
alter table public.manager_approvals add column tab_id uuid references public.tabs (id) on delete cascade;
alter table public.manager_approvals drop constraint manager_approvals_action_check;
alter table public.manager_approvals add constraint manager_approvals_action_check check (action in ('cancelar', 'estornar', 'sangria', 'taxa'));

alter table public.dining_tables enable row level security;
alter table public.tabs enable row level security;
grant select on public.dining_tables, public.tabs to authenticated;
grant all on public.dining_tables, public.tabs to service_role;
grant insert, update, delete on public.dining_tables to authenticated;
create policy "salao ve mesas" on public.dining_tables for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant,waiter}'));
create policy "gerencia cria mesas" on public.dining_tables for insert to authenticated with check (public.manager_can(pizzeria_id, 'configuracoes'));
create policy "gerencia edita mesas" on public.dining_tables for update to authenticated
  using (public.manager_can(pizzeria_id, 'configuracoes')) with check (public.manager_can(pizzeria_id, 'configuracoes'));
create policy "gerencia apaga mesas" on public.dining_tables for delete to authenticated using (public.manager_can(pizzeria_id, 'configuracoes'));
create policy "salao ve contas" on public.tabs for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant,waiter}'));
-- Garçom e atendente veem os pagamentos das contas de mesa (para saber quanto falta).
create policy "salao ve pagamentos de mesa" on public.payments for select to authenticated
  using (tab_id is not null and public.has_role(pizzeria_id, '{owner,manager,cashier,attendant,waiter}'));
-- O garçom só vê as rodadas das mesas (nada de nome, telefone e endereço dos pedidos de entrega).
drop policy "equipe ve pedidos" on public.orders;
create policy "equipe ve pedidos" on public.orders for select to authenticated
  using (public.can_see_order(pizzeria_id, courier_id, status, fulfillment) and (tab_id is not null or not public.has_role(pizzeria_id, '{waiter}')));

-- ============ GARÇOM NAS REGRAS DE PEDIDO ============
create or replace function public.roles_for_transition(_to public.order_status)
returns public.member_role[] language sql immutable as $$
  select case _to
    when 'confirmado' then '{owner,manager,cashier,attendant}'::public.member_role[]
    when 'preparo' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'pronto' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'saiu' then '{owner,manager,cashier,attendant,driver}'::public.member_role[]
    when 'entregue' then '{owner,manager,cashier,attendant,waiter,driver}'::public.member_role[]
    when 'cancelado' then '{owner,manager,cashier,attendant,waiter}'::public.member_role[]
    else '{}'::public.member_role[]
  end
$$;

-- Cancelar: caixa, atendente e garçom precisam do PIN do gerente.
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
  if public.has_role(o.pizzeria_id, '{waiter}') and o.tab_id is null then
    raise exception 'O garçom só mexe nos pedidos das mesas' using errcode = '42501';
  end if;
  if o.status = _to then return o.status; end if;
  if not public.allowed_transition(o.fulfillment, o.status, _to) then
    raise exception 'Não é possível passar de % para %', o.status, _to using errcode = '22023';
  end if;
  if _to = 'cancelado' and length(btrim(coalesce(_note, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento' using errcode = '22023';
  end if;
  if _to = 'cancelado' and public.has_role(o.pizzeria_id, '{cashier,attendant,waiter}') then
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

-- ============ CONTA DA MESA ============
create or replace function public.tab_totals(_tab uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (select * from public.tabs where id = _tab),
  sub as (
    select coalesce(sum(o.total_cents), 0)::int as v from public.orders o, t
    where o.tab_id = t.id and o.status <> 'cancelado'
  ),
  paid as (
    select coalesce(sum(case when p.kind = 'recebimento' then p.amount_cents else -p.amount_cents end), 0)::int as v
    from public.payments p, t where p.tab_id = t.id
  )
  select jsonb_build_object(
    'subtotal', sub.v,
    'service_pct', t.service_fee_pct,
    'service', round(sub.v * t.service_fee_pct / 100)::int,
    'total', sub.v + round(sub.v * t.service_fee_pct / 100)::int,
    'paid', paid.v,
    'remaining', sub.v + round(sub.v * t.service_fee_pct / 100)::int - paid.v)
  from t, sub, paid
$$;

create or replace function public.open_tab(_table uuid, _guests integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m record; v_id uuid;
begin
  select * into m from public.dining_tables where id = _table;
  if not found or not public.has_role(m.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if not m.active then raise exception 'Esta mesa está desativada' using errcode = '22023'; end if;
  if exists (select 1 from public.tabs where table_id = _table and status = 'aberta') then raise exception 'Esta mesa já está aberta' using errcode = '22023'; end if;
  insert into public.tabs (pizzeria_id, table_id, guests, service_fee_pct, opened_by)
  values (m.pizzeria_id, _table, _guests, (select service_fee_pct from public.pizzerias where id = m.pizzeria_id), auth.uid())
  returning tabs.id into v_id;
  return v_id;
end $$;

-- Liga a rodada (criada pelo servidor) à conta e já manda para a cozinha.
create or replace function public.attach_round(_order uuid, _tab uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; o record;
begin
  select * into t from public.tabs where id = _tab;
  select * into o from public.orders where id = _order for update;
  if t is null or o is null or t.pizzeria_id <> o.pizzeria_id or t.status <> 'aberta' or o.channel <> 'mesa' or o.tab_id is not null then
    raise exception 'Rodada inválida' using errcode = '22023';
  end if;
  update public.orders set tab_id = _tab, status = 'confirmado', updated_at = now() where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, 'confirmado', o.created_by, 'Rodada da mesa');
end $$;

-- Taxa de serviço: dono/gerente mudam direto; caixa, atendente e garçom com o PIN do gerente para baixar.
create or replace function public.request_tab_approval(_tab uuid, _pin text)
returns text language plpgsql security definer set search_path = public as $$
declare t record; g record; who record;
begin
  select * into t from public.tabs where id = _tab;
  if not found or not public.has_role(t.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.approval_guard (pizzeria_id) values (t.pizzeria_id) on conflict (pizzeria_id) do nothing;
  select * into g from public.approval_guard where pizzeria_id = t.pizzeria_id for update;
  if g.locked_until is not null and g.locked_until > now() then raise exception 'Muitas tentativas erradas. Espere alguns minutos.' using errcode = '22023'; end if;
  select m.user_id, coalesce(m.display_name, split_part(u.email, '@', 1)) as name into who
  from public.members m join public.member_pins p on p.pizzeria_id = m.pizzeria_id and p.user_id = m.user_id join auth.users u on u.id = m.user_id
  where m.pizzeria_id = t.pizzeria_id and m.role in ('owner', 'manager') and p.pin_hash = public.member_pin_hash(t.pizzeria_id, m.user_id, coalesce(_pin, ''))
  limit 1;
  if not found then
    update public.approval_guard set
      failures = case when failures + 1 >= 5 then 0 else failures + 1 end,
      locked_until = case when failures + 1 >= 5 then now() + interval '10 minutes' else locked_until end
    where pizzeria_id = t.pizzeria_id;
    raise exception 'PIN de gerente errado.' using errcode = '22023';
  end if;
  update public.approval_guard set failures = 0, locked_until = null where pizzeria_id = t.pizzeria_id;
  insert into public.manager_approvals (pizzeria_id, order_id, tab_id, action, requested_by, approved_by) values (t.pizzeria_id, null, _tab, 'taxa', auth.uid(), who.user_id);
  return who.name;
end $$;

create or replace function public.set_tab_service(_tab uuid, _pct numeric, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; approver uuid; nm text;
begin
  select * into t from public.tabs where id = _tab for update;
  if not found or not public.has_role(t.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if t.status <> 'aberta' then raise exception 'Esta conta já foi fechada' using errcode = '22023'; end if;
  if _pct is null or _pct < 0 or _pct > 30 then raise exception 'Taxa inválida' using errcode = '22023'; end if;
  if _pct < t.service_fee_pct and not public.has_role(t.pizzeria_id, '{owner,manager}') then
    update public.manager_approvals set used_at = now()
    where id = (select id from public.manager_approvals where tab_id = _tab and action = 'taxa' and requested_by = auth.uid()
                and used_at is null and created_at > now() - interval '5 minutes' order by created_at desc limit 1)
    returning approved_by into approver;
    if approver is null then raise exception 'Baixar a taxa de serviço precisa do PIN do gerente' using errcode = '42501'; end if;
    select coalesce(display_name, 'gerente') into nm from public.members where pizzeria_id = t.pizzeria_id and user_id = approver;
  end if;
  update public.tabs set service_fee_pct = _pct,
    service_note = left(nullif(btrim(coalesce(_note, '')), '') || coalesce(' · autorizado por ' || nm, ''), 200)
  where id = _tab;
end $$;

-- Pagamento (parcial ou total) da conta. Só quem mexe com dinheiro: dono, gerente e caixa.
create or replace function public.add_tab_payment(_tab uuid, _method public.payment_method, _amount_cents integer, _received_cents integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; tot jsonb; rest integer;
begin
  select * into t from public.tabs where id = _tab for update;
  if not found or not public.has_role(t.pizzeria_id, '{owner,manager,cashier}') then raise exception 'Sem permissão para receber' using errcode = '42501'; end if;
  if t.status <> 'aberta' then raise exception 'Esta conta já foi fechada' using errcode = '22023'; end if;
  tot := public.tab_totals(_tab);
  rest := (tot ->> 'remaining')::int;
  if _amount_cents is null or _amount_cents < 1 then raise exception 'Informe o valor' using errcode = '22023'; end if;
  if _amount_cents > rest then raise exception 'O valor passa do que falta pagar' using errcode = '22023'; end if;
  if _received_cents is not null and (_method <> 'dinheiro' or _received_cents < _amount_cents) then
    raise exception 'Valor recebido inválido' using errcode = '22023';
  end if;
  insert into public.payments (pizzeria_id, order_id, tab_id, kind, method, amount_cents, actor_id, note, change_cents)
  values (t.pizzeria_id, null, _tab, 'recebimento', _method, _amount_cents, auth.uid(), 'Conta da mesa',
          case when _received_cents is not null then _received_cents - _amount_cents end);
  return public.tab_totals(_tab);
end $$;

-- Fechar: só com tudo pago (ou conta sem nada). As rodadas ficam marcadas como recebidas.
create or replace function public.close_tab(_tab uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; tot jsonb;
begin
  select * into t from public.tabs where id = _tab for update;
  if not found then raise exception 'Conta não encontrada' using errcode = '22023'; end if;
  tot := public.tab_totals(_tab);
  if (tot ->> 'subtotal')::int = 0 then
    if not public.has_role(t.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
    update public.tabs set status = 'cancelada', closed_by = auth.uid(), closed_at = now() where id = _tab;
    return;
  end if;
  if not public.has_role(t.pizzeria_id, '{owner,manager,cashier}') then raise exception 'Quem fecha a conta é o caixa' using errcode = '42501'; end if;
  if t.status <> 'aberta' then raise exception 'Esta conta já foi fechada' using errcode = '22023'; end if;
  if (tot ->> 'remaining')::int > 0 then raise exception 'Ainda falta receber %', to_char(((tot ->> 'remaining')::int) / 100.0, 'FM999G990D00') using errcode = '22023'; end if;
  if exists (select 1 from public.orders where tab_id = _tab and status in ('confirmado', 'preparo')) then
    raise exception 'Ainda tem rodada na cozinha' using errcode = '22023';
  end if;
  update public.orders set payment_status = 'recebido', updated_at = now() where tab_id = _tab and status <> 'cancelado';
  update public.tabs set status = 'fechada', closed_by = auth.uid(), closed_at = now() where id = _tab;
end $$;

-- Trocar de mesa (o grupo mudou de lugar).
create or replace function public.move_tab(_tab uuid, _table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; m record;
begin
  select * into t from public.tabs where id = _tab for update;
  select * into m from public.dining_tables where id = _table;
  if t is null or m is null or t.pizzeria_id <> m.pizzeria_id or not public.has_role(t.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if t.status <> 'aberta' then raise exception 'Esta conta já foi fechada' using errcode = '22023'; end if;
  if not m.active or exists (select 1 from public.tabs where table_id = _table and status = 'aberta') then raise exception 'A mesa de destino não está livre' using errcode = '22023'; end if;
  update public.tabs set table_id = _table where id = _tab;
  update public.orders set customer_name = 'Mesa ' || m.name where tab_id = _tab;
end $$;

-- Juntar a conta de uma mesa na outra (rodadas e pagamentos vão juntos).
create or replace function public.merge_tabs(_from uuid, _into uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a record; b record;
begin
  select * into a from public.tabs where id = _from for update;
  select * into b from public.tabs where id = _into for update;
  if a is null or b is null or a.pizzeria_id <> b.pizzeria_id or _from = _into or not public.has_role(a.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if a.status <> 'aberta' or b.status <> 'aberta' then raise exception 'As duas contas precisam estar abertas' using errcode = '22023'; end if;
  update public.orders set tab_id = _into, customer_name = (select 'Mesa ' || name from public.dining_tables where id = b.table_id) where tab_id = _from;
  update public.payments set tab_id = _into where tab_id = _from;
  update public.tabs set guests = case when guests is null and a.guests is null then null else coalesce(guests, 0) + coalesce(a.guests, 0) end where id = _into;
  update public.tabs set status = 'cancelada', merged_into = _into, closed_by = auth.uid(), closed_at = now() where id = _from;
end $$;

-- Passar uma rodada para outra mesa (lançou na mesa errada).
create or replace function public.move_round(_order uuid, _tab uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record; t record;
begin
  select * into o from public.orders where id = _order for update;
  select * into t from public.tabs where id = _tab;
  if o is null or t is null or o.pizzeria_id <> t.pizzeria_id or o.tab_id is null or not public.has_role(o.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if t.status <> 'aberta' or (select status from public.tabs where id = o.tab_id) <> 'aberta' then raise exception 'As duas contas precisam estar abertas' using errcode = '22023'; end if;
  update public.orders set tab_id = _tab, customer_name = (select 'Mesa ' || name from public.dining_tables where id = t.table_id) where id = _order;
end $$;

-- ============ GARÇOM NO BALCÃO E NA EQUIPE ============
create or replace function public.team_role_ok(_pz uuid, _role public.member_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_pz, '{owner}') or (public.manager_can(_pz, 'equipe') and _role in ('cashier', 'attendant', 'waiter', 'kitchen', 'driver'))
$$;

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
      where m.pizzeria_id = pz and m.role in ('owner', 'manager', 'cashier', 'attendant', 'waiter')), '[]'::jsonb));
end $$;

create or replace function public.counter_check_pin(_device text, _user uuid, _pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pz uuid; p record; idle integer;
begin
  select d.pizzeria_id, k.idle_minutes into pz, idle from public.counter_devices d join public.counter_links k on k.pizzeria_id = d.pizzeria_id
  where d.token = _device and k.active;
  if pz is null then return jsonb_build_object('error', 'Este computador saiu do modo balcão. Abra o link do balcão de novo.'); end if;
  select * into p from public.member_pins where pizzeria_id = pz and user_id = _user for update;
  if not found or not exists (select 1 from public.members where pizzeria_id = pz and user_id = _user and role in ('owner', 'manager', 'cashier', 'attendant', 'waiter')) then
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

-- ============ CAIXA DO DIA: pagamentos de mesa entram também ============
create or replace function public.cash_totals(_s public.cash_sessions)
returns jsonb language sql stable security definer set search_path = public as $$
  with win as (select _s.pizzeria_id as pz, _s.opened_at as a, coalesce(_s.closed_at, now()) as b),
  pay as (
    select p.method, p.kind, p.amount_cents, coalesce(o.courier_cash_cents, 0) > 0 as by_courier
    from public.payments p left join public.orders o on o.id = p.order_id, win
    where p.pizzeria_id = win.pz and p.created_at >= win.a and p.created_at <= win.b
  ),
  mov as (select kind, amount_cents from public.cash_movements where session_id = _s.id),
  acerto as (
    select coalesce(sum(o.courier_cash_cents), 0)::int as cash, coalesce(sum(coalesce(o.courier_pay_cents, 0)), 0)::int as pago
    from public.orders o, win where o.pizzeria_id = win.pz and o.settled_at >= win.a and o.settled_at <= win.b
  ),
  t as (
    select
      coalesce(sum(amount_cents) filter (where kind = 'recebimento' and method = 'pix'), 0)::int as pix,
      coalesce(sum(amount_cents) filter (where kind = 'recebimento' and method = 'cartao'), 0)::int as cartao,
      coalesce(sum(amount_cents) filter (where kind = 'recebimento' and method = 'dinheiro' and not by_courier), 0)::int as dinheiro_balcao,
      coalesce(sum(amount_cents) filter (where kind = 'recebimento' and method = 'dinheiro' and by_courier), 0)::int as dinheiro_entregadores,
      coalesce(sum(amount_cents) filter (where kind = 'estorno'), 0)::int as estornos,
      coalesce(sum(amount_cents) filter (where kind = 'estorno' and method = 'dinheiro'), 0)::int as estornos_dinheiro,
      count(*) filter (where kind = 'recebimento')::int as recebimentos
    from pay
  )
  select jsonb_build_object(
    'abertura', _s.opening_cents,
    'pix', t.pix, 'cartao', t.cartao, 'dinheiro_balcao', t.dinheiro_balcao, 'dinheiro_entregadores', t.dinheiro_entregadores,
    'estornos', t.estornos, 'recebimentos', t.recebimentos,
    'total_recebido', t.pix + t.cartao + t.dinheiro_balcao + t.dinheiro_entregadores - t.estornos,
    'suprimentos', (select coalesce(sum(amount_cents), 0)::int from mov where kind = 'suprimento'),
    'sangrias', (select coalesce(sum(amount_cents), 0)::int from mov where kind = 'sangria'),
    'acerto_entregadores', acerto.cash - acerto.pago,
    'esperado_gaveta', _s.opening_cents + t.dinheiro_balcao - t.estornos_dinheiro + (acerto.cash - acerto.pago)
      + (select coalesce(sum(amount_cents), 0)::int from mov where kind = 'suprimento')
      - (select coalesce(sum(amount_cents), 0)::int from mov where kind = 'sangria'))
  from t, acerto
$$;

revoke execute on function public.tab_totals(uuid), public.attach_round(uuid, uuid), public.cash_totals(public.cash_sessions) from public, anon, authenticated;
grant execute on function public.attach_round(uuid, uuid) to service_role;
revoke execute on function public.open_tab(uuid, integer), public.request_tab_approval(uuid, text), public.set_tab_service(uuid, numeric, text),
  public.add_tab_payment(uuid, public.payment_method, integer, integer), public.close_tab(uuid), public.move_tab(uuid, uuid),
  public.merge_tabs(uuid, uuid), public.move_round(uuid, uuid), public.team_role_ok(uuid, public.member_role) from public, anon;
grant execute on function public.open_tab(uuid, integer), public.request_tab_approval(uuid, text), public.set_tab_service(uuid, numeric, text),
  public.add_tab_payment(uuid, public.payment_method, integer, integer), public.close_tab(uuid), public.move_tab(uuid, uuid),
  public.merge_tabs(uuid, uuid), public.move_round(uuid, uuid), public.team_role_ok(uuid, public.member_role) to authenticated;
revoke execute on function public.counter_check_pin(text, uuid, text) from public, anon, authenticated;
grant execute on function public.counter_check_pin(text, uuid, text) to service_role;

-- Conta da mesa vista pelo salão (com os totais).
create or replace function public.tab_view(_tab uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.tabs where id = _tab;
  if not found or not public.has_role(t.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return public.tab_totals(_tab);
end $$;
revoke execute on function public.tab_view(uuid) from public, anon;
grant execute on function public.tab_view(uuid) to authenticated;

-- Tela da cozinha pelo link: mostra o nome da mesa nas rodadas do salão.
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
        'table_name', case when o.channel = 'mesa' then o.customer_name end,
        'created_at', o.created_at, 'updated_at', o.updated_at,
        'cancel', case when o.status = 'cancelado' then jsonb_build_object('at', c.created_at, 'note', c.note, 'from', c.from_status) end,
        'order_items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'size_name', i.size_name, 'flavors', i.flavors,
                                   'extras', i.extras, 'note', i.note, 'qty', i.qty) order by i.id)
                                 from public.order_items i where i.order_id = o.id), '[]'::jsonb)) order by o.created_at)
      from public.orders o
      left join lateral (
        select e.created_at, e.note, e.from_status from public.order_events e
        where e.order_id = o.id and e.to_status = 'cancelado' order by e.created_at desc limit 1
      ) c on true
      where o.pizzeria_id = pz and o.created_at > now() - interval '24 hours'
        and (o.status in ('confirmado', 'preparo', 'pronto')
             or (o.status = 'cancelado' and c.created_at > now() - interval '3 hours' and c.from_status in ('confirmado', 'preparo', 'pronto')))), '[]'::jsonb));
end $$;
