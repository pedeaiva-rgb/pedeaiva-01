-- Mesas (fase 2): QR Code em cada mesa. O cliente vê o cardápio, faz o pedido, chama o garçom e pede a conta.
-- O pedido do cliente chega como "novo" e só vai para a cozinha quando alguém da loja confirma
-- (a não ser que o dono ligue a confirmação automática para mesas já abertas).

-- Código do QR: longo e aleatório (não dá para adivinhar a mesa de outra pessoa). Trocar o código invalida o QR antigo.
alter table public.dining_tables add column qr_token text not null unique default replace(gen_random_uuid()::text, '-', '')
  check (length(qr_token) between 20 and 64);

alter table public.pizzerias add column qr_ordering boolean not null default true;
alter table public.pizzerias add column qr_auto_confirm boolean not null default false;
grant update (qr_ordering, qr_auto_confirm) on public.pizzerias to authenticated;

-- Chamados da mesa: "chamar garçom" e "pedir a conta". Um aberto de cada tipo por mesa (apertar de novo não duplica).
create table public.table_calls (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  table_id uuid not null,
  kind text not null check (kind in ('garcom', 'conta')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  foreign key (pizzeria_id, table_id) references public.dining_tables (pizzeria_id, id) on delete cascade
);
create unique index table_calls_one_open on public.table_calls (table_id, kind) where resolved_at is null;
create index table_calls_pz_idx on public.table_calls (pizzeria_id, created_at desc);
alter table public.table_calls enable row level security;
grant select on public.table_calls to authenticated;
grant all on public.table_calls to service_role;
create policy "salao ve chamados" on public.table_calls for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant,waiter}'));
alter publication supabase_realtime add table public.table_calls;

-- O garçom confirma os pedidos que o cliente fez pelo QR (transition_order só deixa ele mexer nos pedidos de mesa).
create or replace function public.roles_for_transition(_to public.order_status)
returns public.member_role[] language sql immutable as $$
  select case _to
    when 'confirmado' then '{owner,manager,cashier,attendant,waiter}'::public.member_role[]
    when 'preparo' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'pronto' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'saiu' then '{owner,manager,cashier,attendant,driver}'::public.member_role[]
    when 'entregue' then '{owner,manager,cashier,attendant,waiter,driver}'::public.member_role[]
    when 'cancelado' then '{owner,manager,cashier,attendant,waiter}'::public.member_role[]
    else '{}'::public.member_role[]
  end
$$;

-- Recusar um pedido do QR que ainda não foi confirmado não precisa do PIN do gerente (nada foi para a cozinha).
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
  if _to = 'cancelado' and public.has_role(o.pizzeria_id, '{cashier,attendant,waiter}') and not (o.status = 'novo' and o.tab_id is not null) then
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

-- Pedido do cliente ainda não confirmado não entra na conta.
create or replace function public.tab_totals(_tab uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (select * from public.tabs where id = _tab),
  sub as (
    select coalesce(sum(o.total_cents), 0)::int as v from public.orders o, t
    where o.tab_id = t.id and o.status not in ('cancelado', 'novo')
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

create or replace function public.close_tab(_tab uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; tot jsonb;
begin
  select * into t from public.tabs where id = _tab for update;
  if not found then raise exception 'Conta não encontrada' using errcode = '22023'; end if;
  if exists (select 1 from public.orders where tab_id = _tab and status = 'novo') then
    raise exception 'Tem pedido do cliente esperando confirmação' using errcode = '22023';
  end if;
  tot := public.tab_totals(_tab);
  if (tot ->> 'subtotal')::int = 0 then
    if not public.has_role(t.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
    update public.tabs set status = 'cancelada', closed_by = auth.uid(), closed_at = now() where id = _tab;
    update public.table_calls set resolved_at = now(), resolved_by = auth.uid() where table_id = t.table_id and resolved_at is null;
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
  -- Mesa liberada: chamados antigos não ficam piscando para o próximo cliente.
  update public.table_calls set resolved_at = now(), resolved_by = auth.uid() where table_id = t.table_id and resolved_at is null;
end $$;

-- ============ LADO DO CLIENTE (só o servidor do app chama, depois de achar a mesa pelo código do QR) ============
-- Liga o pedido do cliente à conta da mesa. Mesa livre: abre a conta sozinha (a equipe vê e confirma).
create or replace function public.attach_qr_round(_order uuid, _table uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; o record; t record; auto boolean; created boolean := false; pending integer;
begin
  select * into m from public.dining_tables where id = _table for update;
  select * into o from public.orders where id = _order for update;
  if m is null or o is null or m.pizzeria_id <> o.pizzeria_id or not m.active or o.channel <> 'mesa' or o.tab_id is not null or o.status <> 'novo' then
    raise exception 'Pedido inválido' using errcode = '22023';
  end if;
  select * into t from public.tabs where table_id = _table and status = 'aberta';
  if t is null then
    insert into public.tabs (pizzeria_id, table_id, service_fee_pct, opened_by)
    values (m.pizzeria_id, _table, (select service_fee_pct from public.pizzerias where id = m.pizzeria_id), null)
    returning * into t;
    created := true;
  end if;
  select count(*) into pending from public.orders where tab_id = t.id and status = 'novo';
  if pending >= 3 then raise exception 'Espere a equipe confirmar os pedidos anteriores' using errcode = '22023'; end if;
  -- Confirmação automática só vale para mesa que a equipe já abriu (cliente sentado de verdade).
  auto := not created and (select qr_auto_confirm from public.pizzerias where id = m.pizzeria_id);
  update public.orders set tab_id = t.id, status = case when auto then 'confirmado'::public.order_status else 'novo'::public.order_status end, updated_at = now()
  where id = _order;
  if auto then
    insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
    values (o.pizzeria_id, _order, 'novo', 'confirmado', null, 'Pedido do cliente pelo QR (confirmação automática)');
  end if;
  return jsonb_build_object('tab_id', t.id, 'confirmed', auto);
end $$;

create or replace function public.qr_call(_table uuid, _kind text)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.dining_tables where id = _table;
  if m is null or not m.active or _kind not in ('garcom', 'conta') then raise exception 'Mesa inválida' using errcode = '22023'; end if;
  insert into public.table_calls (pizzeria_id, table_id, kind) values (m.pizzeria_id, _table, _kind)
  on conflict (table_id, kind) where resolved_at is null do nothing;
end $$;

-- Equipe marca o chamado como atendido.
create or replace function public.resolve_call(_call uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.table_calls where id = _call for update;
  if c is null or not public.has_role(c.pizzeria_id, '{owner,manager,cashier,attendant,waiter}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.table_calls set resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, auth.uid()) where id = _call;
end $$;

revoke execute on function public.attach_qr_round(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.qr_call(uuid, text) from public, anon, authenticated;
grant execute on function public.attach_qr_round(uuid, uuid), public.qr_call(uuid, text) to service_role;
revoke execute on function public.resolve_call(uuid) from public, anon;
grant execute on function public.resolve_call(uuid) to authenticated;
revoke execute on function public.tab_totals(uuid) from public, anon, authenticated;
