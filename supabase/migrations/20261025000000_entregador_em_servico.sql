-- Entregador "em serviço": durante o turno ele compartilha a localização mesmo sem entrega em rota,
-- e a loja vê quem está disponível. Fora do turno (e sem entrega), nada é guardado.

alter table public.couriers
  add column on_duty boolean not null default false,
  add column on_duty_since timestamptz;

-- O próprio entregador começa ou encerra o turno. Encerrando, a posição é apagada.
create or replace function public.set_courier_on_duty(_pz uuid, _on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_courier_id(_pz);
begin
  if me is null or not public.has_role(_pz, '{driver}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _on and not exists (select 1 from public.couriers where id = me and active) then
    raise exception 'Seu cadastro de entregador está desativado' using errcode = '22023';
  end if;
  update public.couriers set
    on_duty = _on,
    on_duty_since = case when _on then coalesce(on_duty_since, now()) end,
    last_lat = case when _on then last_lat end,
    last_lng = case when _on then last_lng end,
    last_accuracy = case when _on then last_accuracy end
  where id = me;
end $$;

-- Guarda a posição durante o turno ou com entrega em rota.
create or replace function public.update_courier_location(_pz uuid, _lat double precision, _lng double precision, _accuracy real default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_courier_id(_pz);
begin
  if me is null or not public.has_role(_pz, '{driver}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _lat is null or _lng is null or _lat not between -90 and 90 or _lng not between -180 and 180 then
    raise exception 'Posição inválida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.couriers where id = me and on_duty)
     and not exists (select 1 from public.orders where pizzeria_id = _pz and courier_id = me and status = 'saiu') then
    return false;
  end if;
  update public.couriers set last_lat = _lat, last_lng = _lng, last_accuracy = _accuracy, last_seen_at = now() where id = me;
  return true;
end $$;

-- Ao terminar a última entrega, só apaga a posição se ele não estiver em turno.
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
    update public.couriers set last_lat = null, last_lng = null, last_accuracy = null where id = new.courier_id and not on_duty;
  end if;
  return new;
end $$;

-- Desativar o entregador também encerra o turno dele.
create or replace function public.couriers_off_duty_when_inactive()
returns trigger language plpgsql set search_path = public as $$
begin
  if not new.active and old.active then
    new.on_duty := false;
    new.on_duty_since := null;
    new.last_lat := null;
    new.last_lng := null;
    new.last_accuracy := null;
  end if;
  return new;
end $$;
create trigger couriers_off_duty before update of active on public.couriers
  for each row execute function public.couriers_off_duty_when_inactive();

revoke execute on function public.set_courier_on_duty(uuid, boolean) from public, anon;
grant execute on function public.set_courier_on_duty(uuid, boolean) to authenticated;
