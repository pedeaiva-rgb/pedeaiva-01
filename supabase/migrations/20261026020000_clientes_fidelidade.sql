-- Fase C: clientes e recompra.
-- Recompensas (fidelidade, cashback, aniversário) viram cupons pessoais: código único, uso único e só valem
-- para o cliente dono (conferido pelo telefone no pedido). Avaliação do pedido pelo acompanhamento.

-- ============ CUPONS ============
alter table public.coupons
  add column customer_id uuid,
  add column first_order_only boolean not null default false,
  add column origin text not null default 'manual' check (origin in ('manual', 'fidelidade', 'cashback', 'aniversario'));
alter table public.coupons add constraint coupons_customer_fk foreign key (pizzeria_id, customer_id) references public.customers (pizzeria_id, id) on delete cascade;
create index coupons_customer_idx on public.coupons (customer_id) where customer_id is not null;
grant update (first_order_only) on public.coupons to authenticated;

-- Vitrine da loja: cupom pessoal nunca aparece.
create or replace function public.store_coupons(_slug text)
returns table (code text, discount_type public.discount_type, value numeric, min_order_cents integer, ends_at timestamptz, description text)
language sql stable security definer set search_path = public as $$
  select c.code, c.discount_type, c.value, c.min_order_cents, c.ends_at, c.description
  from public.coupons c
  join public.pizzerias z on z.id = c.pizzeria_id
  where z.slug = _slug
    and c.active and c.show_in_store and c.customer_id is null
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at >= now())
    and (c.max_uses is null or c.uses < c.max_uses)
  order by c.created_at desc
  limit 6
$$;

-- ============ CLIENTES ============
alter table public.customers
  add column birthday date check (birthday is null or birthday between date '1900-01-01' and current_date),
  add column notes text check (notes is null or length(notes) <= 500),
  add column marketing_opt_out boolean not null default false;

-- Pedido: cupom pessoal só para o dono; cupom de primeira compra só sem pedido anterior; guarda o aniversário informado.
create or replace function public.create_order(p jsonb)
returns table (order_id uuid, public_token uuid, number integer, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  pz uuid := (p ->> 'pizzeria_id')::uuid;
  key text := p ->> 'idempotency_key';
  ch public.order_channel := (p ->> 'channel')::public.order_channel;
  raw_phone text := btrim(coalesce(p ->> 'customer_phone', ''));
  v_phone text;
  cust uuid;
  cup uuid := nullif(p ->> 'coupon_id', '')::uuid;
  cp record;
  bday date;
  num integer;
  oid uuid;
  tok uuid;
  it jsonb;
  ex record;
begin
  select o.id, o.public_token, o.number into ex from public.orders o where o.pizzeria_id = pz and o.idempotency_key = key;
  if found then
    return query select ex.id, ex.public_token, ex.number, false;
    return;
  end if;

  if raw_phone <> '' then
    v_phone := public.normalize_br_phone(raw_phone);
    if v_phone is null then raise exception 'Telefone inválido: informe DDD + número' using errcode = '22023'; end if;
  elsif ch = 'site' then
    raise exception 'Informe o telefone' using errcode = '22023';
  end if;

  -- Freio contra pedidos em massa pela loja online.
  if ch = 'site' and (
    select count(*) from public.orders o
    where o.pizzeria_id = pz and o.customer_phone = v_phone and o.created_at > now() - interval '10 minutes'
  ) >= 4 then
    raise exception 'Muitos pedidos seguidos com este telefone. Aguarde alguns minutos.' using errcode = '22023';
  end if;

  update public.pizzeria_counters c set next_order_number = c.next_order_number + 1
   where c.pizzeria_id = pz returning c.next_order_number - 1 into num;
  if num is null then raise exception 'Pizzaria inválida'; end if;

  begin
    bday := nullif(p ->> 'birthday', '')::date;
    if bday is not null and (bday < date '1900-01-01' or bday > current_date) then bday := null; end if;
  exception when others then
    bday := null;
  end;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(pz::text || ':' || v_phone, 0));
    select c.id into cust from public.customers c where c.pizzeria_id = pz and c.phone = v_phone;
    if cust is null then
      insert into public.customers (pizzeria_id, name, phone, birthday)
      values (pz, btrim(p ->> 'customer_name'), v_phone, bday) returning id into cust;
    elsif bday is not null then
      update public.customers set birthday = coalesce(birthday, bday) where id = cust;
    end if;
  end if;

  if cup is not null then
    select * into cp from public.coupons c where c.id = cup and c.pizzeria_id = pz for update;
    if not found then raise exception 'Cupom esgotado ou inválido' using errcode = '22023'; end if;
    if cp.customer_id is not null and cp.customer_id is distinct from cust then
      raise exception 'Cupom pessoal: vale só para o cliente que ganhou (mesmo telefone)' using errcode = '22023';
    end if;
    if cp.first_order_only then
      if cust is null then raise exception 'Cupom de primeira compra: informe o telefone' using errcode = '22023'; end if;
      if exists (select 1 from public.orders o where o.customer_id = cust and o.status <> 'cancelado') then
        raise exception 'Cupom válido só na primeira compra' using errcode = '22023';
      end if;
    end if;
    update public.coupons c set uses = c.uses + 1
     where c.id = cup and c.active
       and (c.max_uses is null or c.uses < c.max_uses)
       and (c.starts_at is null or c.starts_at <= now())
       and (c.ends_at is null or c.ends_at >= now());
    if not found then raise exception 'Cupom esgotado ou inválido' using errcode = '22023'; end if;
  end if;

  insert into public.orders (
    pizzeria_id, number, idempotency_key, channel, fulfillment, customer_id, customer_name, customer_phone,
    address, zone_name, subtotal_cents, discount_cents, delivery_fee_cents, total_cents, coupon_id, coupon_code,
    payment_method, change_for_cents, notes, eta_min, eta_max, created_by)
  values (
    pz, num, key, ch, (p ->> 'fulfillment')::public.fulfillment, cust, btrim(p ->> 'customer_name'), coalesce(v_phone, ''),
    case when p ->> 'fulfillment' = 'entrega' then p -> 'address' end, nullif(p ->> 'zone_name', ''),
    (p ->> 'subtotal_cents')::int, (p ->> 'discount_cents')::int, (p ->> 'delivery_fee_cents')::int, (p ->> 'total_cents')::int,
    cup, nullif(p ->> 'coupon_code', ''), (p ->> 'payment_method')::public.payment_method,
    nullif(p ->> 'change_for_cents', '')::int, nullif(btrim(coalesce(p ->> 'notes', '')), ''),
    nullif(p ->> 'eta_min', '')::int, nullif(p ->> 'eta_max', '')::int, nullif(p ->> 'created_by', '')::uuid)
  returning id, orders.public_token into oid, tok;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.order_items (pizzeria_id, order_id, product_id, size_id, name, size_name, flavors, extras, note, qty, unit_price_cents, subtotal_cents)
    values (pz, oid, (it ->> 'product_id')::uuid, nullif(it ->> 'size_id', '')::uuid, it ->> 'name', it ->> 'size_name',
      coalesce(it -> 'flavors', '[]'::jsonb), coalesce(it -> 'extras', '[]'::jsonb), nullif(btrim(coalesce(it ->> 'note', '')), ''),
      (it ->> 'qty')::int, (it ->> 'unit_price_cents')::int, (it ->> 'subtotal_cents')::int);
  end loop;

  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (pz, oid, null, 'novo', nullif(p ->> 'created_by', '')::uuid,
          case ch when 'site' then 'Pedido feito na loja online' else 'Pedido registrado no PDV (' || ch || ')' end);

  return query select oid, tok, num, true;
exception when unique_violation then
  select o.id, o.public_token, o.number into ex from public.orders o where o.pizzeria_id = pz and o.idempotency_key = key;
  if found then
    return query select ex.id, ex.public_token, ex.number, false;
  else
    raise;
  end if;
end $$;

-- Equipe edita aniversário, observações e "não quer receber ofertas".
create or replace function public.update_customer(_id uuid, _birthday date, _notes text, _opt_out boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.customers where id = _id;
  if not found or not public.has_role(c.pizzeria_id, '{owner,manager,cashier,attendant}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _birthday is not null and (_birthday < date '1900-01-01' or _birthday > current_date) then raise exception 'Data de nascimento inválida' using errcode = '22023'; end if;
  update public.customers set birthday = _birthday, notes = nullif(left(btrim(coalesce(_notes, '')), 500), ''), marketing_opt_out = coalesce(_opt_out, false)
  where id = _id;
end $$;

-- Lista de clientes com os números de cada um (pedidos que valeram).
create or replace function public.customer_stats(_pz uuid)
returns table (id uuid, name text, phone text, birthday date, notes text, marketing_opt_out boolean, created_at timestamptz,
               orders integer, spent_cents bigint, first_order_at timestamptz, last_order_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager,cashier,attendant}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return query
    select c.id, c.name, c.phone, c.birthday, c.notes, c.marketing_opt_out, c.created_at,
           count(o.id)::int, coalesce(sum(o.total_cents), 0)::bigint, min(o.created_at), max(o.created_at)
    from public.customers c
    left join public.orders o on o.customer_id = c.id and o.status not in ('novo', 'cancelado')
    where c.pizzeria_id = _pz
    group by c.id;
end $$;

-- Para a tela de Clientes (caixa e atendente não leem a tabela de cupons): prêmios ativos de um cliente
-- e os cupons da loja que dá para mandar na mensagem.
create or replace function public.customer_coupons(_customer uuid)
returns table (code text, discount_type public.discount_type, value numeric, ends_at timestamptz, origin text, used boolean)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.customers where id = _customer;
  if not found or not public.has_role(c.pizzeria_id, '{owner,manager,cashier,attendant}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return query select cp.code, cp.discount_type, cp.value, cp.ends_at, cp.origin, (cp.max_uses is not null and cp.uses >= cp.max_uses)
    from public.coupons cp where cp.customer_id = _customer order by cp.created_at desc limit 30;
end $$;

create or replace function public.staff_coupons(_pz uuid)
returns table (code text, discount_type public.discount_type, value numeric, min_order_cents integer, ends_at timestamptz, first_order_only boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner,manager,cashier,attendant}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return query select c.code, c.discount_type, c.value, c.min_order_cents, c.ends_at, c.first_order_only
    from public.coupons c
    where c.pizzeria_id = _pz and c.customer_id is null and c.active
      and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at >= now())
      and (c.max_uses is null or c.uses < c.max_uses)
    order by c.created_at desc;
end $$;

-- ============ FIDELIDADE ============
-- "selos": a cada N pedidos entregues (acima do mínimo), ganha um cupom.
-- "cashback": cada pedido entregue (acima do mínimo) gera um cupom de X% do valor para o próximo pedido.
create table public.loyalty_programs (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  active boolean not null default false,
  mode text not null default 'selos' check (mode in ('selos', 'cashback')),
  stamps_needed integer not null default 10 check (stamps_needed between 2 and 50),
  min_order_cents integer not null default 0 check (min_order_cents between 0 and 100000000),
  reward_type public.discount_type not null default 'valor',
  reward_value numeric(10, 2) not null default 20 check (reward_value > 0),
  cashback_pct numeric(5, 2) not null default 5 check (cashback_pct > 0 and cashback_pct <= 50),
  reward_days integer not null default 60 check (reward_days between 7 and 365),
  updated_at timestamptz not null default now(),
  check (reward_type <> 'percentual' or reward_value <= 100)
);
create table public.loyalty_progress (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  stamps integer not null default 0 check (stamps >= 0),
  rewards integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_progress enable row level security;
grant select, insert, update on public.loyalty_programs to authenticated;
grant select on public.loyalty_progress to authenticated;
grant all on public.loyalty_programs, public.loyalty_progress to service_role;
create policy "equipe ve fidelidade" on public.loyalty_programs for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant}'));
create policy "gerencia cria fidelidade" on public.loyalty_programs for insert to authenticated with check (public.manager_can(pizzeria_id, 'cupons'));
create policy "gerencia edita fidelidade" on public.loyalty_programs for update to authenticated
  using (public.manager_can(pizzeria_id, 'cupons')) with check (public.manager_can(pizzeria_id, 'cupons'));
create policy "equipe ve progresso" on public.loyalty_progress for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant}'));

create or replace function public.new_reward_code(_prefix text)
returns text language sql volatile set search_path = public as $$
  select _prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
$$;

-- Pedido entregue: dá o selo (ou o cashback) e cria o cupom pessoal quando é a hora.
create or replace function public.loyalty_on_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
declare lp record; pr record; v_code text; cents integer;
begin
  if new.status <> 'entregue' or old.status = 'entregue' or new.customer_id is null then return new; end if;
  select * into lp from public.loyalty_programs where pizzeria_id = new.pizzeria_id and active;
  if not found or new.total_cents < lp.min_order_cents then return new; end if;
  if lp.mode = 'cashback' then
    cents := floor(new.total_cents * lp.cashback_pct / 100);
    if cents >= 100 then
      insert into public.coupons (pizzeria_id, code, discount_type, value, max_uses, ends_at, customer_id, origin, description)
      values (new.pizzeria_id, public.new_reward_code('CASH'), 'valor', cents / 100.0, 1, now() + make_interval(days => lp.reward_days), new.customer_id, 'cashback',
              'Cashback do pedido #' || new.number);
    end if;
    return new;
  end if;
  insert into public.loyalty_progress (customer_id, pizzeria_id, stamps) values (new.customer_id, new.pizzeria_id, 1)
  on conflict (customer_id) do update set stamps = loyalty_progress.stamps + 1, updated_at = now()
  returning * into pr;
  if pr.stamps >= lp.stamps_needed then
    update public.loyalty_progress set stamps = 0, rewards = rewards + 1, updated_at = now() where customer_id = new.customer_id;
    insert into public.coupons (pizzeria_id, code, discount_type, value, max_uses, ends_at, customer_id, origin, description)
    values (new.pizzeria_id, public.new_reward_code('FIEL'), lp.reward_type, lp.reward_value, 1, now() + make_interval(days => lp.reward_days), new.customer_id, 'fidelidade',
            'Prêmio do cartão fidelidade');
  end if;
  return new;
end $$;
create trigger orders_loyalty after update of status on public.orders for each row execute function public.loyalty_on_delivered();

-- Presente de aniversário: a equipe gera um cupom pessoal para o cliente.
create or replace function public.birthday_coupon(_customer uuid, _type public.discount_type, _value numeric, _days integer default 15)
returns text language plpgsql security definer set search_path = public as $$
declare c record; v_code text;
begin
  select * into c from public.customers where id = _customer;
  if not found or not public.manager_can(c.pizzeria_id, 'cupons') and not public.has_role(c.pizzeria_id, '{cashier,attendant}') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if _value is null or _value <= 0 or (_type = 'percentual' and _value > 100) or (_type = 'valor' and _value > 500) then raise exception 'Valor do presente inválido' using errcode = '22023'; end if;
  v_code := public.new_reward_code('NIVER');
  insert into public.coupons (pizzeria_id, code, discount_type, value, max_uses, ends_at, customer_id, origin, description)
  values (c.pizzeria_id, v_code, _type, _value, 1, now() + make_interval(days => greatest(1, least(coalesce(_days, 15), 60))), _customer, 'aniversario', 'Presente de aniversário');
  return v_code;
end $$;

-- ============ AVALIAÇÕES ============
create table public.order_reviews (
  order_id uuid primary key references public.orders (id) on delete cascade,
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index order_reviews_pz_idx on public.order_reviews (pizzeria_id, created_at desc);
alter table public.order_reviews enable row level security;
grant select on public.order_reviews to authenticated;
grant all on public.order_reviews to service_role;
create policy "equipe ve avaliacoes" on public.order_reviews for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier,attendant}'));

-- Cliente avalia pelo link do acompanhamento (o código do link é a chave): só pedido entregue, até 7 dias, uma vez.
create or replace function public.submit_review(_token uuid, _rating integer, _comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select id, pizzeria_id, status, coalesce(delivered_at, updated_at) as done_at into o from public.orders where public_token = _token;
  if not found then raise exception 'Pedido não encontrado' using errcode = '22023'; end if;
  if o.status <> 'entregue' then raise exception 'Dá para avaliar quando o pedido for entregue' using errcode = '22023'; end if;
  if o.done_at < now() - interval '7 days' then raise exception 'O prazo para avaliar este pedido acabou' using errcode = '22023'; end if;
  if _rating is null or _rating < 1 or _rating > 5 then raise exception 'Escolha de 1 a 5 estrelas' using errcode = '22023'; end if;
  insert into public.order_reviews (order_id, pizzeria_id, rating, comment)
  values (o.id, o.pizzeria_id, _rating, nullif(left(btrim(coalesce(_comment, '')), 500), ''))
  on conflict (order_id) do nothing;
end $$;

-- Nota da loja na vitrine (só com pelo menos 3 avaliações nos últimos 180 dias).
create or replace function public.store_rating(_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when count(*) >= 3 then jsonb_build_object('avg', round(avg(r.rating)::numeric, 1), 'count', count(*)) end
  from public.order_reviews r join public.pizzerias z on z.id = r.pizzeria_id
  where z.slug = _slug and r.created_at > now() - interval '180 days'
$$;

-- Acompanhamento: inclui avaliação feita, prêmios do cliente e o cartão de selos.
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
               from public.order_events e where e.order_id = o.id and e.from_status is distinct from e.to_status), '[]'::jsonb),
    'review', (select jsonb_build_object('rating', r.rating) from public.order_reviews r where r.order_id = o.id),
    'can_review', o.status = 'entregue' and coalesce(o.delivered_at, o.updated_at) > now() - interval '7 days'
                  and not exists (select 1 from public.order_reviews r where r.order_id = o.id),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('code', cp.code, 'type', cp.discount_type, 'value', cp.value,
                   'ends_at', cp.ends_at, 'origin', cp.origin) order by cp.created_at desc)
               from public.coupons cp
               where o.customer_id is not null and cp.customer_id = o.customer_id and cp.active
                 and (cp.max_uses is null or cp.uses < cp.max_uses) and (cp.ends_at is null or cp.ends_at >= now())), '[]'::jsonb),
    'loyalty', (select jsonb_build_object('stamps', coalesce((select lp2.stamps from public.loyalty_progress lp2 where lp2.customer_id = o.customer_id), 0),
                                          'needed', lp.stamps_needed, 'reward_type', lp.reward_type, 'reward_value', lp.reward_value)
                from public.loyalty_programs lp where lp.pizzeria_id = o.pizzeria_id and lp.active and lp.mode = 'selos' and o.customer_id is not null))
  from public.orders o join public.pizzerias z on z.id = o.pizzeria_id
  where o.public_token = _token
$$;

revoke execute on function public.customer_coupons(uuid) from public, anon;
grant execute on function public.customer_coupons(uuid) to authenticated;
revoke execute on function public.staff_coupons(uuid) from public, anon;
grant execute on function public.staff_coupons(uuid) to authenticated;
revoke execute on function public.update_customer(uuid, date, text, boolean) from public, anon;
grant execute on function public.update_customer(uuid, date, text, boolean) to authenticated;
revoke execute on function public.customer_stats(uuid) from public, anon;
grant execute on function public.customer_stats(uuid) to authenticated;
revoke execute on function public.birthday_coupon(uuid, public.discount_type, numeric, integer) from public, anon;
grant execute on function public.birthday_coupon(uuid, public.discount_type, numeric, integer) to authenticated;
revoke execute on function public.loyalty_on_delivered() from public, anon, authenticated;
revoke execute on function public.new_reward_code(text) from public, anon, authenticated;
revoke execute on function public.submit_review(uuid, integer, text) from public;
grant execute on function public.submit_review(uuid, integer, text) to anon, authenticated;
revoke execute on function public.store_rating(text) from public;
grant execute on function public.store_rating(text) to anon, authenticated;
