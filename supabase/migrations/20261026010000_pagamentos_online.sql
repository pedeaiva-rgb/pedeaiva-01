-- Pagamento online (Pix no pedido da loja online).
-- Cada pizzaria tem uma "conta de pagamento" num provedor: hoje o Mercado Pago com a conta da própria loja
-- (conectada por autorização), amanhã subcontas criadas pela plataforma (Tuna, Pagar.me, Asaas...).
-- O pedido com Pix só nasce quando o pagamento é confirmado: até lá ele fica guardado na cobrança.

alter table public.pizzerias add column online_pix boolean not null default false;

-- Conta de pagamento da loja (sem segredos: o que o painel mostra).
create table public.payment_accounts (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{2,30}$'),
  mode text not null check (mode in ('conta_propria', 'subconta')),
  status text not null default 'ativa' check (status in ('ativa', 'pendente', 'desconectada', 'erro')),
  external_account_id text check (external_account_id is null or length(external_account_id) <= 120),
  account_label text check (account_label is null or length(account_label) <= 120),
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Credenciais (tokens) criptografadas pelo servidor do app. Ninguém do painel lê: só o servidor (service_role).
create table public.payment_secrets (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  data text not null check (length(data) <= 8000),
  updated_at timestamptz not null default now()
);

-- Cobrança Pix: o QR que o cliente paga e o pedido pronto para ser criado quando o dinheiro entrar.
create table public.online_charges (
  id uuid primary key default gen_random_uuid(),
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 16 and 80),
  provider text not null,
  external_id text check (external_id is null or length(external_id) <= 120),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'expirado', 'cancelado', 'estornado', 'erro')),
  amount_cents integer not null check (amount_cents > 0),
  order_payload jsonb not null,
  order_id uuid references public.orders (id) on delete set null,
  order_token uuid,
  qr_code text check (qr_code is null or length(qr_code) <= 2000),
  qr_image text check (qr_image is null or length(qr_image) <= 200000),
  expires_at timestamptz not null,
  paid_at timestamptz,
  refunded_at timestamptz,
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pizzeria_id, idempotency_key),
  unique (provider, external_id)
);
create index online_charges_pz_idx on public.online_charges (pizzeria_id, created_at desc);
create index online_charges_order_idx on public.online_charges (order_id) where order_id is not null;

alter table public.payment_accounts enable row level security;
alter table public.payment_secrets enable row level security;
alter table public.online_charges enable row level security;
grant select on public.payment_accounts to authenticated;
-- Da cobrança, a equipe só lê se foi paga e por onde (o QR e o pedido guardado ficam com o servidor).
grant select (id, pizzeria_id, provider, external_id, status, amount_cents, order_id, expires_at, paid_at, refunded_at, error, created_at) on public.online_charges to authenticated;
grant all on public.payment_accounts, public.payment_secrets, public.online_charges to service_role;
revoke all on public.payment_secrets from anon, authenticated;
create policy "gerencia ve conta de pagamento" on public.payment_accounts for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "caixa ve cobrancas" on public.online_charges for select to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager,cashier}'));

-- Pagamento confirmado no provedor: cria o pedido, registra o recebimento e marca a cobrança como paga.
-- Chamada de novo (aviso repetido do provedor) devolve o mesmo pedido.
create or replace function public.settle_online_charge(_charge uuid, _paid_cents integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; r record;
begin
  select * into c from public.online_charges where id = _charge for update;
  if not found then raise exception 'Cobrança não encontrada' using errcode = '22023'; end if;
  if c.status = 'pago' then return jsonb_build_object('order_id', c.order_id, 'token', c.order_token, 'created', false); end if;
  -- Pix pago depois do prazo ainda vale (o dinheiro entrou); estornada/cancelada não.
  if c.status not in ('pendente', 'expirado') then raise exception 'Cobrança % não pode ser paga', c.status using errcode = '22023'; end if;
  if _paid_cents is null or _paid_cents < c.amount_cents then raise exception 'Valor pago menor que o pedido' using errcode = '22023'; end if;
  begin
    select * into r from public.create_order(c.order_payload);
  exception when others then
    -- Pagou, mas o pedido não pôde ser criado (ex.: cupom esgotou): o servidor devolve o dinheiro.
    update public.online_charges set status = 'erro', error = left('Pedido não criado: ' || sqlerrm, 500), paid_at = now(), updated_at = now() where id = _charge;
    return jsonb_build_object('order_id', null, 'error', sqlerrm);
  end;
  insert into public.payments (pizzeria_id, order_id, kind, method, amount_cents, actor_id, note)
  values (c.pizzeria_id, r.order_id, 'recebimento', 'pix', c.amount_cents, null, 'Pix online (' || c.provider || ')')
  on conflict (order_id) where kind = 'recebimento' do nothing;
  update public.orders set payment_status = 'recebido', updated_at = now() where id = r.order_id;
  update public.online_charges set status = 'pago', paid_at = now(), order_id = r.order_id, order_token = r.public_token, error = null, updated_at = now()
  where id = _charge;
  return jsonb_build_object('order_id', r.order_id, 'token', r.public_token, 'created', true);
end $$;

revoke execute on function public.settle_online_charge(uuid, integer) from public, anon, authenticated;
grant execute on function public.settle_online_charge(uuid, integer) to service_role;
