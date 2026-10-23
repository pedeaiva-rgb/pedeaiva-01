-- Cozinha e entregas: entregadores, atribuição ao pedido e horários de saída/entrega.

create table public.couriers (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  phone text check (phone is null or phone ~ '^[0-9]{10,11}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (pizzeria_id, id)
);

alter table public.orders
  add column courier_id uuid,
  add column dispatched_at timestamptz,
  add column delivered_at timestamptz;
alter table public.orders
  add constraint orders_courier_fk foreign key (pizzeria_id, courier_id) references public.couriers (pizzeria_id, id);
create index orders_courier_idx on public.orders (pizzeria_id, courier_id, delivered_at desc);

alter table public.couriers enable row level security;
grant select, insert, update, delete on public.couriers to authenticated;
grant all on public.couriers to service_role;
create policy "equipe ve entregadores" on public.couriers for select to authenticated using (public.is_member(pizzeria_id));
create policy "gerencia cadastra entregadores" on public.couriers for insert to authenticated with check (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "gerencia edita entregadores" on public.couriers for update to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager}')) with check (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "gerencia apaga entregadores" on public.couriers for delete to authenticated using (public.has_role(pizzeria_id, '{owner,manager}'));

-- Atribui (ou tira, com null) o entregador de um pedido de entrega em andamento.
create or replace function public.assign_courier(_order uuid, _courier uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record; c record;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, '{owner,manager,cashier}') then
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
revoke execute on function public.assign_courier(uuid, uuid) from public, anon;
grant execute on function public.assign_courier(uuid, uuid) to authenticated;

-- Mesmas regras de antes; agora grava a hora em que saiu e em que foi entregue.
create or replace function public.transition_order(_order uuid, _to public.order_status, _note text default null)
returns public.order_status language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, public.roles_for_transition(_to)) then
    raise exception 'Sem permissão para esta ação' using errcode = '42501';
  end if;
  if o.status = _to then return o.status; end if;
  if not public.allowed_transition(o.fulfillment, o.status, _to) then
    raise exception 'Não é possível passar de % para %', o.status, _to using errcode = '22023';
  end if;
  if _to = 'cancelado' and length(btrim(coalesce(_note, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento' using errcode = '22023';
  end if;
  update public.orders set
    status = _to,
    updated_at = now(),
    dispatched_at = case when _to = 'saiu' then now() else dispatched_at end,
    delivered_at = case when _to = 'entregue' then now() else delivered_at end
  where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, _to, auth.uid(), nullif(left(btrim(coalesce(_note, '')), 300), ''));
  return _to;
end $$;
