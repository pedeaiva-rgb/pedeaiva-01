-- Caixa do dia: abrir com o troco, sangria (tirar) e suprimento (colocar) com motivo, e fechar contando a gaveta.
-- O caixa fecha "às cegas" (digita o que contou sem ver o esperado); dono e gerente veem o esperado e a diferença.

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  opening_cents integer not null check (opening_cents between 0 and 10000000),
  closed_by uuid,
  closed_at timestamptz,
  counted_cents integer check (counted_cents is null or counted_cents between 0 and 100000000),
  expected_cents integer,
  difference_cents integer,
  summary jsonb,
  note text check (note is null or length(note) <= 300)
);
-- Um caixa aberto por loja.
create unique index cash_sessions_one_open on public.cash_sessions (pizzeria_id) where status = 'aberto';
create index cash_sessions_pz_idx on public.cash_sessions (pizzeria_id, opened_at desc);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions (id) on delete cascade,
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  kind text not null check (kind in ('sangria', 'suprimento')),
  amount_cents integer not null check (amount_cents between 1 and 10000000),
  reason text not null check (length(btrim(reason)) between 3 and 200),
  actor_id uuid,
  approved_by uuid,
  created_at timestamptz not null default now()
);
create index cash_movements_session_idx on public.cash_movements (session_id, created_at);

alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
grant select on public.cash_sessions, public.cash_movements to authenticated;
grant all on public.cash_sessions, public.cash_movements to service_role;
create policy "caixa ve sessoes" on public.cash_sessions for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier}'));
create policy "caixa ve movimentos" on public.cash_movements for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier}'));

-- Autorização do gerente também para sangria (sem pedido).
alter table public.manager_approvals alter column order_id drop not null;
alter table public.manager_approvals drop constraint manager_approvals_action_check;
alter table public.manager_approvals add constraint manager_approvals_action_check check (action in ('cancelar', 'estornar', 'sangria'));

create or replace function public.request_cash_approval(_pz uuid, _pin text)
returns text language plpgsql security definer set search_path = public as $$
declare g record; who record;
begin
  if not public.has_role(_pz, '{owner,manager,cashier}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.approval_guard (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  select * into g from public.approval_guard where pizzeria_id = _pz for update;
  if g.locked_until is not null and g.locked_until > now() then
    raise exception 'Muitas tentativas erradas. Espere alguns minutos.' using errcode = '22023';
  end if;
  select m.user_id, coalesce(m.display_name, split_part(u.email, '@', 1)) as name into who
  from public.members m join public.member_pins p on p.pizzeria_id = m.pizzeria_id and p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.pizzeria_id = _pz and m.role in ('owner', 'manager') and p.pin_hash = public.member_pin_hash(_pz, m.user_id, coalesce(_pin, ''))
  limit 1;
  if not found then
    update public.approval_guard set
      failures = case when failures + 1 >= 5 then 0 else failures + 1 end,
      locked_until = case when failures + 1 >= 5 then now() + interval '10 minutes' else locked_until end
    where pizzeria_id = _pz;
    raise exception 'PIN de gerente errado.' using errcode = '22023';
  end if;
  update public.approval_guard set failures = 0, locked_until = null where pizzeria_id = _pz;
  insert into public.manager_approvals (pizzeria_id, order_id, action, requested_by, approved_by) values (_pz, null, 'sangria', auth.uid(), who.user_id);
  return who.name;
end $$;

-- ============ CONTAS DO CAIXA ============
-- Tudo o que entrou e saiu no período do caixa. Dinheiro recebido pelo entregador só entra na gaveta no acerto.
create or replace function public.cash_totals(_s public.cash_sessions)
returns jsonb language sql stable security definer set search_path = public as $$
  with win as (select _s.pizzeria_id as pz, _s.opened_at as a, coalesce(_s.closed_at, now()) as b),
  pay as (
    select p.method, p.kind, p.amount_cents, coalesce(o.courier_cash_cents, 0) > 0 as by_courier
    from public.payments p join public.orders o on o.id = p.order_id, win
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

-- Caixa aberto agora (ou null). Para o caixa, o esperado da gaveta fica escondido até fechar.
create or replace function public.cash_current(_pz uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; tot jsonb; boss boolean;
begin
  if not public.has_role(_pz, '{owner,manager,cashier}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select * into s from public.cash_sessions where pizzeria_id = _pz and status = 'aberto';
  if not found then return null; end if;
  boss := public.has_role(_pz, '{owner,manager}');
  tot := public.cash_totals(s);
  if not boss then tot := tot - 'esperado_gaveta'; end if;
  return jsonb_build_object(
    'id', s.id, 'opened_at', s.opened_at, 'opening_cents', s.opening_cents,
    'opened_by', (select coalesce(m.display_name, split_part(u.email, '@', 1)) from public.members m join auth.users u on u.id = m.user_id where m.pizzeria_id = _pz and m.user_id = s.opened_by),
    'totals', tot, 'can_see_expected', boss);
end $$;

create or replace function public.open_cash(_pz uuid, _opening_cents integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.has_role(_pz, '{owner,manager,cashier}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _opening_cents is null or _opening_cents < 0 or _opening_cents > 10000000 then raise exception 'Valor de abertura inválido' using errcode = '22023'; end if;
  if exists (select 1 from public.cash_sessions where pizzeria_id = _pz and status = 'aberto') then
    raise exception 'Já existe um caixa aberto' using errcode = '22023';
  end if;
  insert into public.cash_sessions (pizzeria_id, opened_by, opening_cents) values (_pz, auth.uid(), _opening_cents) returning id into sid;
  return sid;
end $$;

-- Sangria (tirar da gaveta) pelo caixa precisa do PIN do gerente; suprimento (colocar) não.
create or replace function public.cash_movement(_pz uuid, _kind text, _amount_cents integer, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s record; approver uuid;
begin
  if not public.has_role(_pz, '{owner,manager,cashier}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _kind not in ('sangria', 'suprimento') then raise exception 'Tipo inválido' using errcode = '22023'; end if;
  if _amount_cents is null or _amount_cents < 1 then raise exception 'Informe o valor' using errcode = '22023'; end if;
  if length(btrim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo' using errcode = '22023'; end if;
  select * into s from public.cash_sessions where pizzeria_id = _pz and status = 'aberto';
  if not found then raise exception 'Abra o caixa primeiro' using errcode = '22023'; end if;
  if _kind = 'sangria' and not public.has_role(_pz, '{owner,manager}') then
    update public.manager_approvals set used_at = now()
    where id = (select id from public.manager_approvals where pizzeria_id = _pz and action = 'sangria' and requested_by = auth.uid()
                and used_at is null and created_at > now() - interval '5 minutes' order by created_at desc limit 1)
    returning approved_by into approver;
    if approver is null then raise exception 'Sangria precisa do PIN do gerente' using errcode = '42501'; end if;
  end if;
  insert into public.cash_movements (session_id, pizzeria_id, kind, amount_cents, reason, actor_id, approved_by)
  values (s.id, _pz, _kind, _amount_cents, left(btrim(_reason), 200), auth.uid(), approver);
end $$;

-- Fechar: guarda o que foi contado, o esperado e a diferença (sobra + / falta −).
create or replace function public.close_cash(_pz uuid, _counted_cents integer, _note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; tot jsonb; expected integer;
begin
  if not public.has_role(_pz, '{owner,manager,cashier}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _counted_cents is null or _counted_cents < 0 then raise exception 'Informe quanto tem na gaveta' using errcode = '22023'; end if;
  select * into s from public.cash_sessions where pizzeria_id = _pz and status = 'aberto' for update;
  if not found then raise exception 'Não há caixa aberto' using errcode = '22023'; end if;
  s.closed_at := now();
  tot := public.cash_totals(s);
  expected := (tot ->> 'esperado_gaveta')::int;
  update public.cash_sessions set status = 'fechado', closed_by = auth.uid(), closed_at = s.closed_at, counted_cents = _counted_cents,
    expected_cents = expected, difference_cents = _counted_cents - expected, summary = tot, note = nullif(left(btrim(coalesce(_note, '')), 300), '')
  where id = s.id;
  return tot || jsonb_build_object('contado', _counted_cents, 'diferenca', _counted_cents - expected, 'session_id', s.id);
end $$;

revoke execute on function public.cash_totals(public.cash_sessions) from public, anon, authenticated;
revoke execute on function public.request_cash_approval(uuid, text), public.cash_current(uuid), public.open_cash(uuid, integer),
  public.cash_movement(uuid, text, integer, text), public.close_cash(uuid, integer, text) from public, anon;
grant execute on function public.request_cash_approval(uuid, text), public.cash_current(uuid), public.open_cash(uuid, integer),
  public.cash_movement(uuid, text, integer, text), public.close_cash(uuid, integer, text) to authenticated;
