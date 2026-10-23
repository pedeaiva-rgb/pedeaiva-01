-- Pede aí e vá — esquema inicial (várias pizzarias, loja online, pedidos e PDV).
-- Regras: cada tabela de loja tem pizzeria_id; o isolamento é feito no banco (RLS),
-- e pedidos/pagamentos só mudam por funções que conferem a permissão de quem chama.

-- ============ TIPOS ============
create type public.member_role as enum ('owner', 'manager', 'cashier', 'kitchen', 'driver');
create type public.order_status as enum ('novo', 'confirmado', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado');
create type public.fulfillment as enum ('entrega', 'retirada');
create type public.order_channel as enum ('site', 'balcao', 'telefone', 'whatsapp');
create type public.payment_method as enum ('pix', 'cartao', 'dinheiro');
create type public.payment_status as enum ('pendente', 'recebido', 'estornado');
create type public.half_pricing as enum ('mais_caro', 'media');
create type public.delivery_mode as enum ('fixa', 'bairro');
create type public.discount_type as enum ('percentual', 'valor');

-- ============ PIZZARIAS E EQUIPE ============
create table public.pizzerias (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 300),
  phone text check (phone is null or length(phone) <= 25),
  address text check (address is null or length(address) <= 200),
  accepting_orders boolean not null default true,
  allow_delivery boolean not null default true,
  allow_pickup boolean not null default true,
  min_order_cents integer not null default 0 check (min_order_cents between 0 and 100000000),
  prep_minutes integer not null default 30 check (prep_minutes between 5 and 240),
  half_pricing public.half_pricing not null default 'mais_caro',
  delivery_mode public.delivery_mode not null default 'fixa',
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents between 0 and 100000000),
  delivery_eta_min integer not null default 30 check (delivery_eta_min between 0 and 600),
  delivery_eta_max integer not null default 50 check (delivery_eta_max between 0 and 600),
  -- { "0".."6" (0 = domingo): [{ "open": "HH:MM", "close": "HH:MM" }] }; vazio = só a pausa manual vale.
  opening_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contador fora da tabela pública para não expor o volume de pedidos da loja.
create table public.pizzeria_counters (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  next_order_number integer not null default 1
);

create table public.members (
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  display_name text check (display_name is null or length(display_name) <= 80),
  created_at timestamptz not null default now(),
  primary key (pizzeria_id, user_id)
);
create index members_user_idx on public.members (user_id);

create or replace function public.has_role(_pz uuid, _roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    where m.pizzeria_id = _pz and m.user_id = auth.uid() and m.role = any (_roles)
  )
$$;

create or replace function public.is_member(_pz uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.pizzeria_id = _pz and m.user_id = auth.uid())
$$;

-- ============ CARDÁPIO ============
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort integer not null default 0,
  active boolean not null default true,
  unique (pizzeria_id, id),
  unique (pizzeria_id, name)
);

create table public.sizes (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  description text not null default '' check (length(description) <= 80),
  max_flavors integer not null default 1 check (max_flavors between 1 and 4),
  sort integer not null default 0,
  active boolean not null default true,
  unique (pizzeria_id, id),
  unique (pizzeria_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  category_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  image_url text check (image_url is null or image_url ~ '^https://'),
  is_pizza boolean not null default false,
  price_cents integer not null default 0 check (price_cents between 0 and 100000000),
  available boolean not null default true,
  featured boolean not null default false,
  archived boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pizzeria_id, id),
  foreign key (pizzeria_id, category_id) references public.categories (pizzeria_id, id) on delete restrict
);
create index products_pz_idx on public.products (pizzeria_id, category_id, sort);

-- Preço de cada pizza por tamanho (sem linha = não vende nesse tamanho).
create table public.product_prices (
  pizzeria_id uuid not null,
  product_id uuid not null,
  size_id uuid not null,
  price_cents integer not null check (price_cents between 0 and 100000000),
  primary key (product_id, size_id),
  foreign key (pizzeria_id, product_id) references public.products (pizzeria_id, id) on delete cascade,
  foreign key (pizzeria_id, size_id) references public.sizes (pizzeria_id, id) on delete cascade
);

create table public.extras (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  price_cents integer not null check (price_cents between 0 and 100000000),
  pizza_only boolean not null default true,
  available boolean not null default true,
  sort integer not null default 0,
  unique (pizzeria_id, id)
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  neighborhoods text[] not null default '{}',
  fee_cents integer not null check (fee_cents between 0 and 100000000),
  eta_min integer check (eta_min between 0 and 600),
  eta_max integer check (eta_max between 0 and 600),
  active boolean not null default true,
  unique (pizzeria_id, id)
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,30}$'),
  discount_type public.discount_type not null,
  value numeric(10, 2) not null check (value > 0),
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer check (max_uses > 0),
  uses integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percentual' or value <= 100),
  unique (pizzeria_id, code),
  unique (pizzeria_id, id)
);

-- ============ CLIENTES E PEDIDOS ============
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  name text not null,
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  created_at timestamptz not null default now(),
  unique (pizzeria_id, phone),
  unique (pizzeria_id, id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete restrict,
  number integer not null,
  public_token uuid not null default gen_random_uuid() unique,
  idempotency_key text not null check (length(idempotency_key) between 16 and 80),
  channel public.order_channel not null,
  status public.order_status not null default 'novo',
  fulfillment public.fulfillment not null,
  customer_id uuid,
  customer_name text not null check (length(customer_name) <= 80),
  customer_phone text not null default '',
  address jsonb,
  zone_name text,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  coupon_id uuid,
  coupon_code text,
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pendente',
  change_for_cents integer check (change_for_cents is null or change_for_cents >= 0),
  notes text check (notes is null or length(notes) <= 300),
  eta_min integer,
  eta_max integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pizzeria_id, number),
  unique (pizzeria_id, idempotency_key),
  unique (pizzeria_id, id),
  foreign key (pizzeria_id, customer_id) references public.customers (pizzeria_id, id),
  foreign key (pizzeria_id, coupon_id) references public.coupons (pizzeria_id, id)
);
create index orders_pz_created_idx on public.orders (pizzeria_id, created_at desc);
create index orders_pz_status_idx on public.orders (pizzeria_id, status);
create index orders_phone_recent_idx on public.orders (pizzeria_id, customer_phone, created_at desc);

-- Itens guardam uma "foto" do nome e do preço: mudar o cardápio não altera pedidos antigos.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  size_id uuid,
  name text not null,
  size_name text,
  flavors jsonb not null default '[]'::jsonb,
  extras jsonb not null default '[]'::jsonb,
  note text check (note is null or length(note) <= 200),
  qty integer not null check (qty between 1 and 50),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  foreign key (pizzeria_id, order_id) references public.orders (pizzeria_id, id) on delete cascade
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null,
  order_id uuid not null,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now(),
  foreign key (pizzeria_id, order_id) references public.orders (pizzeria_id, id) on delete cascade
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Só se acrescenta: recebimento e estorno são linhas novas, nunca edição.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('recebimento', 'estorno')),
  method public.payment_method not null,
  amount_cents integer not null check (amount_cents >= 0),
  reverses_id uuid references public.payments (id),
  actor_id uuid,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  foreign key (pizzeria_id, order_id) references public.orders (pizzeria_id, id) on delete cascade,
  check ((kind = 'estorno') = (reverses_id is not null))
);
create unique index payments_one_receipt on public.payments (order_id) where kind = 'recebimento';
create unique index payments_one_refund on public.payments (reverses_id) where reverses_id is not null;
create index payments_pz_created_idx on public.payments (pizzeria_id, created_at desc);

-- ============ GATILHOS ============
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger pizzerias_touch before update on public.pizzerias for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

-- A loja nunca fica sem proprietário (exceto quando a própria pizzaria é apagada).
create or replace function public.guard_last_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.pizzerias where id = old.pizzeria_id) then
    return old;
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (select 1 from public.members where pizzeria_id = old.pizzeria_id and role = 'owner' and user_id <> old.user_id) then
      raise exception 'A pizzaria precisa de ao menos um proprietário';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger members_guard_last_owner before update or delete on public.members
  for each row execute function public.guard_last_owner();

-- ============ TELEFONE ============
-- Forma canônica: só dígitos, DDD + número (10 fixo começando em 2-5; 11 celular começando em 9). NULL = inválido.
-- Espelhado em src/lib/phone.ts.
create or replace function public.normalize_br_phone(_raw text)
returns text language plpgsql immutable parallel safe set search_path = public as $$
declare d text; ddd int;
begin
  if _raw is null or length(_raw) > 25 or _raw !~ '^[0-9()+\-.\s]*$' then return null; end if;
  d := regexp_replace(_raw, '\D', '', 'g');
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3);
  elsif length(d) in (11, 12) and left(d, 1) = '0' then d := substr(d, 2);
  end if;
  if length(d) not in (10, 11) then return null; end if;
  ddd := left(d, 2)::int;
  if not (ddd = any (array[11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,
      51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99])) then
    return null;
  end if;
  if length(d) = 11 and substr(d, 3, 1) <> '9' then return null; end if;
  if length(d) = 10 and substr(d, 3, 1) not in ('2', '3', '4', '5') then return null; end if;
  return d;
end $$;

-- ============ CRIAR PIZZARIA ============
create or replace function public.create_pizzeria(_name text, _slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pz uuid; s text := lower(btrim(_slug)); c_pizza uuid;
begin
  if auth.uid() is null then raise exception 'Faça login para criar a pizzaria' using errcode = '42501'; end if;
  if s = any (array['painel','entrar','cadastro','recuperar','nova-senha','auth','api','pedido','planos','sobre','ajuda','admin','loja','www','app'])
  then
    raise exception 'Este endereço é reservado. Escolha outro.' using errcode = '22023';
  end if;
  if (select count(*) from public.members where user_id = auth.uid() and role = 'owner') >= 5 then
    raise exception 'Limite de pizzarias por conta atingido' using errcode = '22023';
  end if;
  insert into public.pizzerias (name, slug) values (btrim(_name), s) returning id into pz;
  insert into public.pizzeria_counters (pizzeria_id) values (pz);
  insert into public.members (pizzeria_id, user_id, role) values (pz, auth.uid(), 'owner');
  -- Ponto de partida editável: a loja já nasce com categorias e tamanhos.
  insert into public.categories (pizzeria_id, name, sort) values (pz, 'Pizzas', 1) returning id into c_pizza;
  insert into public.categories (pizzeria_id, name, sort) values (pz, 'Bebidas', 2), (pz, 'Sobremesas', 3);
  insert into public.sizes (pizzeria_id, name, description, max_flavors, sort) values
    (pz, 'Broto', '4 fatias', 1, 1),
    (pz, 'Média', '6 fatias', 2, 2),
    (pz, 'Grande', '8 fatias', 2, 3),
    (pz, 'Família', '12 fatias', 3, 4);
  return pz;
exception when unique_violation then
  raise exception 'Este endereço de loja já está em uso. Escolha outro.' using errcode = '23505';
end $$;

create or replace function public.add_member_by_email(_pz uuid, _email text, _role public.member_role, _name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(_email));
  if uid is null then
    raise exception 'Nenhuma conta com esse e-mail. Peça para a pessoa se cadastrar primeiro.' using errcode = '22023';
  end if;
  insert into public.members (pizzeria_id, user_id, role, display_name)
  values (_pz, uid, _role, nullif(btrim(coalesce(_name, '')), ''))
  on conflict (pizzeria_id, user_id) do update set role = excluded.role, display_name = coalesce(excluded.display_name, public.members.display_name);
end $$;

-- ============ CRIAR PEDIDO ============
-- Chamada só pelo servidor (service_role), depois que o preço foi recalculado no servidor.
-- Repetir com a mesma chave de idempotência devolve o mesmo pedido.
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

  if cup is not null then
    update public.coupons c set uses = c.uses + 1
     where c.id = cup and c.pizzeria_id = pz and c.active
       and (c.max_uses is null or c.uses < c.max_uses)
       and (c.starts_at is null or c.starts_at <= now())
       and (c.ends_at is null or c.ends_at >= now());
    if not found then raise exception 'Cupom esgotado ou inválido' using errcode = '22023'; end if;
  end if;

  update public.pizzeria_counters c set next_order_number = c.next_order_number + 1
   where c.pizzeria_id = pz returning c.next_order_number - 1 into num;
  if num is null then raise exception 'Pizzaria inválida'; end if;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(pz::text || ':' || v_phone, 0));
    select c.id into cust from public.customers c where c.pizzeria_id = pz and c.phone = v_phone;
    if cust is null then
      insert into public.customers (pizzeria_id, name, phone)
      values (pz, btrim(p ->> 'customer_name'), v_phone) returning id into cust;
    end if;
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

-- ============ STATUS DO PEDIDO ============
create or replace function public.allowed_transition(_f public.fulfillment, _from public.order_status, _to public.order_status)
returns boolean language sql immutable as $$
  select case
    when _to = 'cancelado' then _from not in ('entregue', 'cancelado')
    when _from = 'novo' then _to = 'confirmado'
    when _from = 'confirmado' then _to in ('preparo', 'pronto')
    when _from = 'preparo' then _to = 'pronto'
    when _from = 'pronto' and _f = 'entrega' then _to = 'saiu'
    when _from = 'pronto' and _f = 'retirada' then _to = 'entregue'
    when _from = 'saiu' then _to = 'entregue'
    else false
  end
$$;

create or replace function public.roles_for_transition(_to public.order_status)
returns public.member_role[] language sql immutable as $$
  select case _to
    when 'confirmado' then '{owner,manager,cashier}'::public.member_role[]
    when 'preparo' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'pronto' then '{owner,manager,cashier,kitchen}'::public.member_role[]
    when 'saiu' then '{owner,manager,cashier,driver}'::public.member_role[]
    when 'entregue' then '{owner,manager,cashier,driver}'::public.member_role[]
    when 'cancelado' then '{owner,manager,cashier}'::public.member_role[]
    else '{}'::public.member_role[]
  end
$$;

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
  update public.orders set status = _to, updated_at = now() where id = _order;
  insert into public.order_events (pizzeria_id, order_id, from_status, to_status, actor_id, note)
  values (o.pizzeria_id, _order, o.status, _to, auth.uid(), nullif(left(btrim(coalesce(_note, '')), 300), ''));
  return _to;
end $$;

-- ============ PAGAMENTO (presencial) ============
create or replace function public.register_payment(_order uuid, _method public.payment_method, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, '{owner,manager,cashier}') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if o.status = 'cancelado' then raise exception 'Pedido cancelado não recebe pagamento' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where order_id = _order and kind = 'recebimento') then
    raise exception 'Este pedido já tem recebimento registrado' using errcode = '22023';
  end if;
  insert into public.payments (pizzeria_id, order_id, kind, method, amount_cents, actor_id, note)
  values (o.pizzeria_id, _order, 'recebimento', _method, o.total_cents, auth.uid(), nullif(left(btrim(coalesce(_note, '')), 300), ''));
  update public.orders set payment_status = 'recebido', updated_at = now() where id = _order;
end $$;

create or replace function public.refund_payment(_order uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o record; rec record;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, '{owner,manager}') then
    raise exception 'Somente proprietário ou gerente pode estornar' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo do estorno' using errcode = '22023'; end if;
  select * into rec from public.payments where order_id = _order and kind = 'recebimento';
  if not found then raise exception 'Não há recebimento para estornar' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where reverses_id = rec.id) then
    raise exception 'Este recebimento já foi estornado' using errcode = '22023';
  end if;
  insert into public.payments (pizzeria_id, order_id, kind, method, amount_cents, reverses_id, actor_id, note)
  values (o.pizzeria_id, _order, 'estorno', rec.method, rec.amount_cents, rec.id, auth.uid(), left(btrim(_reason), 300));
  update public.orders set payment_status = 'estornado', updated_at = now() where id = _order;
end $$;

-- ============ ACOMPANHAMENTO PÚBLICO ============
-- Pelo link do pedido: sem telefone, sem endereço.
create or replace function public.get_order_tracking(_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'fulfillment', o.fulfillment, 'created_at', o.created_at,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'subtotal_cents', o.subtotal_cents, 'discount_cents', o.discount_cents,
    'delivery_fee_cents', o.delivery_fee_cents, 'total_cents', o.total_cents,
    'eta_min', o.eta_min, 'eta_max', o.eta_max,
    'pizzeria', jsonb_build_object('name', z.name, 'slug', z.slug, 'phone', z.phone),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'size_name', i.size_name, 'qty', i.qty,
                 'extras', i.extras, 'subtotal_cents', i.subtotal_cents) order by i.id)
               from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at)
               from public.order_events e where e.order_id = o.id), '[]'::jsonb))
  from public.orders o join public.pizzerias z on z.id = o.pizzeria_id
  where o.public_token = _token
$$;

-- ============ PERMISSÕES DE ACESSO ============
alter table public.pizzerias enable row level security;
alter table public.pizzeria_counters enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.sizes enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.extras enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.coupons enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.payments enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.pizzerias, public.categories, public.sizes, public.products, public.product_prices,
  public.extras, public.delivery_zones to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke all on public.pizzeria_counters from anon, authenticated;

-- Loja pública: dados de vitrine são abertos.
create policy "vitrine pizzarias" on public.pizzerias for select to anon, authenticated using (true);
create policy "gerencia edita pizzaria" on public.pizzerias for update to authenticated
  using (public.has_role(id, '{owner,manager}')) with check (public.has_role(id, '{owner,manager}'));

do $$
declare t text;
begin
  foreach t in array array['categories', 'sizes', 'products', 'product_prices', 'extras', 'delivery_zones'] loop
    execute format('create policy "vitrine" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "gerencia insere" on public.%I for insert to authenticated with check (public.has_role(pizzeria_id, ''{owner,manager}''))', t);
    execute format('create policy "gerencia edita" on public.%I for update to authenticated using (public.has_role(pizzeria_id, ''{owner,manager}'')) with check (public.has_role(pizzeria_id, ''{owner,manager}''))', t);
    execute format('create policy "gerencia apaga" on public.%I for delete to authenticated using (public.has_role(pizzeria_id, ''{owner,manager}''))', t);
  end loop;
end $$;

-- Cupons: só a gerência vê (a loja confere o código no servidor).
create policy "gerencia ve cupons" on public.coupons for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "gerencia cria cupons" on public.coupons for insert to authenticated with check (public.has_role(pizzeria_id, '{owner,manager}') and uses = 0);
create policy "gerencia edita cupons" on public.coupons for update to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager}')) with check (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "gerencia apaga cupons nao usados" on public.coupons for delete to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager}') and uses = 0);
-- O contador de usos só muda quando um pedido é criado.
revoke update on public.coupons from authenticated;
grant update (code, discount_type, value, min_order_cents, starts_at, ends_at, max_uses, active) on public.coupons to authenticated;

-- O endereço da loja (slug) não muda pelo painel: quebraria links já divulgados.
revoke update on public.pizzerias from authenticated;
grant update (name, description, phone, address, accepting_orders, allow_delivery, allow_pickup, min_order_cents,
  prep_minutes, half_pricing, delivery_mode, delivery_fee_cents, delivery_eta_min, delivery_eta_max, opening_hours)
  on public.pizzerias to authenticated;
revoke insert, delete on public.pizzerias from authenticated;

create policy "ve a propria equipe" on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member(pizzeria_id));
create policy "dono remove membros" on public.members for delete to authenticated
  using (public.has_role(pizzeria_id, '{owner}') and user_id <> auth.uid());
create policy "dono muda funcao" on public.members for update to authenticated
  using (public.has_role(pizzeria_id, '{owner}') and user_id <> auth.uid())
  with check (public.has_role(pizzeria_id, '{owner}'));
revoke insert, update on public.members from authenticated;
grant update (role, display_name) on public.members to authenticated;

-- Pedidos e clientes: só a equipe da própria loja; escrita apenas pelas funções acima.
create policy "equipe ve clientes" on public.customers for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier,driver}'));
create policy "equipe ve pedidos" on public.orders for select to authenticated using (public.is_member(pizzeria_id));
create policy "equipe ve itens" on public.order_items for select to authenticated using (public.is_member(pizzeria_id));
create policy "equipe ve historico" on public.order_events for select to authenticated using (public.is_member(pizzeria_id));
create policy "caixa ve pagamentos" on public.payments for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager,cashier}'));
revoke insert, update, delete on public.customers, public.orders, public.order_items, public.order_events, public.payments from authenticated;

-- Funções: ninguém executa por padrão; liberadas uma a uma.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.has_role(uuid, public.member_role[]) to anon, authenticated;
grant execute on function public.is_member(uuid) to anon, authenticated;
grant execute on function public.normalize_br_phone(text) to anon, authenticated, service_role;
grant execute on function public.create_pizzeria(text, text) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, public.member_role, text) to authenticated;
grant execute on function public.transition_order(uuid, public.order_status, text) to authenticated;
grant execute on function public.register_payment(uuid, public.payment_method, text) to authenticated;
grant execute on function public.refund_payment(uuid, text) to authenticated;
grant execute on function public.get_order_tracking(uuid) to anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
grant execute on function public.allowed_transition(public.fulfillment, public.order_status, public.order_status) to authenticated;
grant execute on function public.roles_for_transition(public.order_status) to authenticated;
grant execute on function public.touch_updated_at() to authenticated, service_role;
grant execute on function public.guard_last_owner() to authenticated, service_role;

-- ============ TEMPO REAL ============
alter publication supabase_realtime add table public.orders;

-- ============ FOTOS DOS PRODUTOS ============
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Caminho do arquivo: <pizzeria_id>/<arquivo>. Só a gerência da loja envia ou apaga.
create or replace function public.storage_pizzeria_id(_name text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.storage_pizzeria_id(text) to authenticated;

create policy "gerencia envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.has_role(public.storage_pizzeria_id(name), '{owner,manager}'));
create policy "gerencia troca fotos" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_role(public.storage_pizzeria_id(name), '{owner,manager}'));
create policy "gerencia apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_role(public.storage_pizzeria_id(name), '{owner,manager}'));
