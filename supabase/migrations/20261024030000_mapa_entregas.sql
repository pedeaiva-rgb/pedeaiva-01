-- Mapa das entregas: ponto da loja e de cada endereço no mapa, posição ao vivo do entregador
-- (só enquanto ele tem pedido em rota) e o que o cliente vê no acompanhamento.

alter table public.pizzerias
  add column lat double precision check (lat is null or lat between -90 and 90),
  add column lng double precision check (lng is null or lng between -180 and 180);

-- Mudou o endereço da loja: o ponto no mapa é recalculado.
create or replace function public.reset_store_location()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.address is distinct from old.address then
    new.lat := null;
    new.lng := null;
  end if;
  return new;
end $$;
create trigger pizzerias_reset_location before update of address on public.pizzerias
  for each row execute function public.reset_store_location();

-- Endereço do pedido no mapa. "aproximado" = só achou o bairro; "falhou" = não achou (não tenta de novo).
alter table public.orders
  add column dest_lat double precision check (dest_lat is null or dest_lat between -90 and 90),
  add column dest_lng double precision check (dest_lng is null or dest_lng between -180 and 180),
  add column geo_status text check (geo_status is null or geo_status in ('ok', 'aproximado', 'falhou'));

-- Última posição do entregador (não guarda histórico de onde ele andou).
alter table public.couriers
  add column last_lat double precision check (last_lat is null or last_lat between -90 and 90),
  add column last_lng double precision check (last_lng is null or last_lng between -180 and 180),
  add column last_accuracy real,
  add column last_seen_at timestamptz;

-- O celular do entregador manda a posição enquanto ele tem entrega em rota.
create or replace function public.update_courier_location(_pz uuid, _lat double precision, _lng double precision, _accuracy real default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_courier_id(_pz);
begin
  if me is null or not public.has_role(_pz, '{driver}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _lat is null or _lng is null or _lat not between -90 and 90 or _lng not between -180 and 180 then
    raise exception 'Posição inválida' using errcode = '22023';
  end if;
  -- Fora de rota, não guarda nada: a localização só é compartilhada durante a entrega.
  if not exists (select 1 from public.orders where pizzeria_id = _pz and courier_id = me and status = 'saiu') then return false; end if;
  update public.couriers set last_lat = _lat, last_lng = _lng, last_accuracy = _accuracy, last_seen_at = now() where id = me;
  return true;
end $$;

-- Ao entregar o último pedido em rota, apaga a posição do entregador.
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
  if new.status in ('entregue', 'cancelado') and old.status = 'saiu' and new.courier_id is not null
     and not exists (select 1 from public.orders where courier_id = new.courier_id and status = 'saiu' and id <> new.id) then
    update public.couriers set last_lat = null, last_lng = null, last_accuracy = null where id = new.courier_id;
  end if;
  return new;
end $$;

-- Acompanhamento: em rota, mostra onde está o entregador (posição de até 10 min atrás) e o destino.
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
    'map', case when o.status = 'saiu' and o.fulfillment = 'entrega' then jsonb_build_object(
      'dest', case when o.dest_lat is not null then jsonb_build_object('lat', o.dest_lat, 'lng', o.dest_lng) end,
      'store', case when z.lat is not null then jsonb_build_object('lat', z.lat, 'lng', z.lng) end,
      'courier', (select jsonb_build_object('lat', c.last_lat, 'lng', c.last_lng, 'at', c.last_seen_at)
                  from public.couriers c where c.id = o.courier_id and c.last_lat is not null and c.last_seen_at > now() - interval '10 minutes')) end,
    'pizzeria', jsonb_build_object('name', z.name, 'slug', z.slug, 'phone', z.phone),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'size_name', i.size_name, 'qty', i.qty,
                 'extras', i.extras, 'subtotal_cents', i.subtotal_cents) order by i.id)
               from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at)
               from public.order_events e where e.order_id = o.id and e.from_status is distinct from e.to_status), '[]'::jsonb))
  from public.orders o join public.pizzerias z on z.id = o.pizzeria_id
  where o.public_token = _token
$$;

revoke execute on function public.update_courier_location(uuid, double precision, double precision, real) from public, anon;
grant execute on function public.update_courier_location(uuid, double precision, double precision, real) to authenticated;
