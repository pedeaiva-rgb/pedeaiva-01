-- Painel do entregador: ele só vê as entregas dele e as disponíveis, pega pedido pronto, confirma
-- a entrega com o código do cliente e acompanha quanto ganhou. A loja define como paga e faz o acerto.

-- ============ REGRAS DA LOJA ============
create type public.courier_pay as enum ('taxa', 'fixo', 'taxa_mais_fixo');

alter table public.pizzerias
  add column couriers_self_assign boolean not null default true,
  add column require_delivery_code boolean not null default true,
  add column courier_pay_mode public.courier_pay not null default 'taxa',
  add column courier_pay_fixed_cents integer not null default 0 check (courier_pay_fixed_cents between 0 and 100000);
grant update (couriers_self_assign, require_delivery_code, courier_pay_mode, courier_pay_fixed_cents) on public.pizzerias to authenticated;

-- Cada entregador pode ter um combinado próprio (vazio = o padrão da loja).
alter table public.couriers
  add column pay_mode public.courier_pay,
  add column pay_fixed_cents integer check (pay_fixed_cents is null or pay_fixed_cents between 0 and 100000);

-- ============ PEDIDO ============
alter table public.orders
  add column courier_pay_cents integer check (courier_pay_cents is null or courier_pay_cents >= 0),
  add column courier_cash_cents integer not null default 0 check (courier_cash_cents >= 0),
  add column settled_at timestamptz;
create index orders_settle_idx on public.orders (pizzeria_id, courier_id, settled_at) where status = 'entregue';

-- Código de entrega fica à parte: o entregador não pode ler (é o cliente quem informa).
create table public.delivery_codes (
  order_id uuid primary key,
  pizzeria_id uuid not null,
  code text not null check (code ~ '^[0-9]{4}$'),
  foreign key (pizzeria_id, order_id) references public.orders (pizzeria_id, id) on delete cascade
);

create or replace function public.new_delivery_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fulfillment = 'entrega' then
    insert into public.delivery_codes (order_id, pizzeria_id, code)
    values (new.id, new.pizzeria_id, lpad((floor(random() * 10000))::int::text, 4, '0'));
  end if;
  return null;
end $$;
create trigger orders_delivery_code after insert on public.orders for each row execute function public.new_delivery_code();

insert into public.delivery_codes (order_id, pizzeria_id, code)
select id, pizzeria_id, lpad((floor(random() * 10000))::int::text, 4, '0') from public.orders
where fulfillment = 'entrega' and status not in ('entregue', 'cancelado')
on conflict do nothing;

-- ============ QUEM É O ENTREGADOR ============
create or replace function public.my_courier_id(_pz uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.couriers c where c.pizzeria_id = _pz and c.user_id = auth.uid() and auth.uid() is not null
$$;

-- Entregador vê só o que é dele e, se a loja deixa, os pedidos prontos sem entregador.
create or replace function public.can_see_order(_pz uuid, _courier uuid, _status public.order_status, _f public.fulfillment)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not public.is_member(_pz) then false
    when not public.has_role(_pz, '{driver}') then true
    when _courier is not null then _courier = public.my_courier_id(_pz)
    else _status = 'pronto' and _f = 'entrega'
      and (select couriers_self_assign from public.pizzerias where id = _pz)
      and public.my_courier_id(_pz) is not null
  end
$$;

drop policy "equipe ve pedidos" on public.orders;
create policy "equipe ve pedidos" on public.orders for select to authenticated
  using (public.can_see_order(pizzeria_id, courier_id, status, fulfillment));
drop policy "equipe ve itens" on public.order_items;
create policy "equipe ve itens" on public.order_items for select to authenticated
  using (public.is_member(pizzeria_id) and exists (select 1 from public.orders o where o.id = order_id));
drop policy "equipe ve historico" on public.order_events;
create policy "equipe ve historico" on public.order_events for select to authenticated
  using (public.is_member(pizzeria_id) and exists (select 1 from public.orders o where o.id = order_id));
-- O entregador não precisa da lista de clientes (o nome e o telefone vêm no pedido).
drop policy "equipe ve clientes" on public.customers;
create policy "equipe ve clientes" on public.customers for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant}'));
-- Entregador vê só o próprio cadastro (não o telefone dos colegas).
drop policy "equipe ve entregadores" on public.couriers;
create policy "equipe ve entregadores" on public.couriers for select to authenticated
  using (public.is_member(pizzeria_id) and (not public.has_role(pizzeria_id, '{driver}') or user_id = auth.uid()));

alter table public.delivery_codes enable row level security;
grant select on public.delivery_codes to authenticated;
grant all on public.delivery_codes to service_role;
create policy "loja ve codigo" on public.delivery_codes for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant}'));

-- ============ QUANTO O ENTREGADOR GANHA ============
create or replace function public.courier_pay_for(o public.orders)
returns integer language sql stable security definer set search_path = public as $$
  select case coalesce(c.pay_mode, z.courier_pay_mode)
    when 'taxa' then o.delivery_fee_cents
    when 'fixo' then coalesce(c.pay_fixed_cents, z.courier_pay_fixed_cents)
    else o.delivery_fee_cents + coalesce(c.pay_fixed_cents, z.courier_pay_fixed_cents)
  end
  from public.pizzerias z left join public.couriers c on c.id = o.courier_id
  where z.id = o.pizzeria_id
$$;

-- Na hora da entrega: guarda quanto o entregador ganhou e, se o cliente pagou na porta,
-- registra o recebimento (dinheiro fica "em mãos" do entregador até o acerto).
create or replace function public.on_order_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status = 'entregue' and old.status <> 'entregue' and new.fulfillment = 'entrega' and new.courier_id is not null then
    new.courier_pay_cents := public.courier_pay_for(new);
    if new.payment_status = 'pendente' and new.payment_method in ('dinheiro', 'cartao') then
      select name into v_name from public.couriers where id = new.courier_id;
      insert into public.payments (pizzeria_id, order_id, kind, method, amount_cents, actor_id, note)
      values (new.pizzeria_id, new.id, 'recebimento', new.payment_method, new.total_cents, auth.uid(), left('Recebido na entrega por ' || v_name, 300));
      new.payment_status := 'recebido';
      if new.payment_method = 'dinheiro' then new.courier_cash_cents := new.total_cents; end if;
    end if;
  end if;
  return new;
end $$;
create trigger orders_on_delivered before update of status on public.orders for each row execute function public.on_order_delivered();

-- ============ AÇÕES DO ENTREGADOR ============
create or replace function public.take_order(_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record; me uuid;
begin
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado' using errcode = '22023'; end if;
  me := public.my_courier_id(o.pizzeria_id);
  if me is null or not public.has_role(o.pizzeria_id, '{driver}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if not (select couriers_self_assign from public.pizzerias where id = o.pizzeria_id) then
    raise exception 'Nesta loja quem escolhe o entregador é o atendimento' using errcode = '42501';
  end if;
  if not exists (select 1 from public.couriers where id = me and active) then raise exception 'Seu cadastro de entregador está desativado' using errcode = '22023'; end if;
  if o.fulfillment <> 'entrega' or o.status <> 'pronto' then raise exception 'Este pedido não está pronto para sair' using errcode = '22023'; end if;
  if o.courier_id is not null then raise exception 'Outro entregador já pegou este pedido' using errcode = '22023'; end if;
  update public.orders set courier_id = me, updated_at = now() where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, o.status, auth.uid(), 'Entregador pegou o pedido');
end $$;

create or replace function public.release_order(_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.orders where id = _order for update;
  if not found or o.courier_id is distinct from public.my_courier_id(o.pizzeria_id) or o.courier_id is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if o.status <> 'pronto' then raise exception 'Depois que saiu, fale com a loja para trocar o entregador' using errcode = '22023'; end if;
  update public.orders set courier_id = null, updated_at = now() where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, o.status, auth.uid(), 'Entregador devolveu o pedido');
end $$;

-- Mesmas regras de antes, mais: entregador só mexe nos pedidos dele e, se a loja exige,
-- só marca entregue com o código do cliente (via complete_delivery).
create or replace function public.transition_order(_order uuid, _to public.order_status, _note text default null)
returns public.order_status language plpgsql security definer set search_path = public as $$
declare o record;
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

-- Entregador confirma a entrega com o código que o cliente recebeu.
create or replace function public.complete_delivery(_order uuid, _code text)
returns void language plpgsql security definer set search_path = public as $$
declare o record; ok boolean;
begin
  select * into o from public.orders where id = _order;
  if not found then raise exception 'Pedido não encontrado' using errcode = '22023'; end if;
  if (select require_delivery_code from public.pizzerias where id = o.pizzeria_id) then
    select d.code = btrim(coalesce(_code, '')) into ok from public.delivery_codes d where d.order_id = _order;
    if not coalesce(ok, false) then raise exception 'Código errado. Confira com o cliente.' using errcode = '22023'; end if;
  end if;
  perform set_config('pav.codigo_ok', '1', true);
  perform public.transition_order(_order, 'entregue', 'Entrega confirmada pelo entregador');
  perform set_config('pav.codigo_ok', '', true);
end $$;

-- ============ ACERTO ============
create or replace function public.settle_courier(_courier uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare c record; n integer;
begin
  select * into c from public.couriers where id = _courier;
  if not found or not public.has_role(c.pizzeria_id, '{owner,manager}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.orders set settled_at = now()
  where pizzeria_id = c.pizzeria_id and courier_id = _courier and status = 'entregue' and settled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ============ CLIENTE: ENTREGADOR E CÓDIGO NO ACOMPANHAMENTO ============
create or replace function public.get_order_tracking(_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'fulfillment', o.fulfillment, 'created_at', o.created_at,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'subtotal_cents', o.subtotal_cents, 'discount_cents', o.discount_cents,
    'delivery_fee_cents', o.delivery_fee_cents, 'total_cents', o.total_cents,
    'eta_min', o.eta_min, 'eta_max', o.eta_max,
    'courier_name', (select split_part(c.name, ' ', 1) from public.couriers c where c.id = o.courier_id),
    'delivery_code', case when o.status not in ('entregue', 'cancelado') and z.require_delivery_code
                       then (select d.code from public.delivery_codes d where d.order_id = o.id) end,
    'pizzeria', jsonb_build_object('name', z.name, 'slug', z.slug, 'phone', z.phone),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'size_name', i.size_name, 'qty', i.qty,
                 'extras', i.extras, 'subtotal_cents', i.subtotal_cents) order by i.id)
               from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at)
               from public.order_events e where e.order_id = o.id and e.from_status is distinct from e.to_status), '[]'::jsonb))
  from public.orders o join public.pizzerias z on z.id = o.pizzeria_id
  where o.public_token = _token
$$;

-- Aviso do WhatsApp leva o nome do entregador e o código de entrega.
create or replace function public.order_webhook_payload(_event text, o public.orders, _previous public.order_status, _site_url text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evento', _event,
    'enviado_em', now(),
    'pizzaria', jsonb_build_object('slug', z.slug, 'nome', z.name, 'telefone', z.phone),
    'pedido', jsonb_build_object(
      'numero', o.number,
      'status', o.status,
      'status_anterior', _previous,
      'canal', o.channel,
      'tipo', o.fulfillment,
      'total_centavos', o.total_cents,
      'forma_pagamento', o.payment_method,
      'previsao_min', o.eta_min,
      'previsao_max', o.eta_max,
      'link_acompanhamento', coalesce(rtrim(_site_url, '/'), '') || '/pedido/' || o.public_token,
      'codigo_entrega', case when z.require_delivery_code then (select d.code from public.delivery_codes d where d.order_id = o.id) end),
    'entregador', (select jsonb_build_object('nome', split_part(c.name, ' ', 1)) from public.couriers c where c.id = o.courier_id),
    'cliente', jsonb_build_object(
      'nome', o.customer_name,
      'telefone', nullif(o.customer_phone, ''),
      'whatsapp', case when o.customer_phone <> '' then '55' || o.customer_phone end))
  from public.pizzerias z where z.id = o.pizzeria_id
$$;

-- ============ PERMISSÕES DAS FUNÇÕES ============
revoke execute on function public.new_delivery_code(), public.my_courier_id(uuid),
  public.can_see_order(uuid, uuid, public.order_status, public.fulfillment), public.courier_pay_for(public.orders),
  public.on_order_delivered(), public.take_order(uuid), public.release_order(uuid), public.complete_delivery(uuid, text),
  public.settle_courier(uuid) from public, anon;
grant execute on function public.my_courier_id(uuid), public.can_see_order(uuid, uuid, public.order_status, public.fulfillment),
  public.take_order(uuid), public.release_order(uuid), public.complete_delivery(uuid, text), public.settle_courier(uuid) to authenticated;
revoke execute on function public.order_webhook_payload(text, public.orders, public.order_status, text) from public, anon, authenticated;
