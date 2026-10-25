-- Tela da cozinha pelo link: inclui os pedidos cancelados nas últimas 3 horas que já tinham ido para a cozinha,
-- com a hora e o motivo, para ninguém continuar preparando o que foi cancelado.
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
