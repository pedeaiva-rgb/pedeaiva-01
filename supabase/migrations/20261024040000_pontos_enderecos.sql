-- Endereços que a loja já conhece: quando o cliente marca a localização no checkout ou alguém
-- corrige o ponto no mapa, o sistema guarda e usa de novo nos próximos pedidos do mesmo endereço.
create table public.address_points (
  pizzeria_id uuid not null references public.pizzerias (id) on delete cascade,
  -- "rua|numero|bairro" (endereço exato) ou "rua||bairro" (mesma rua), sem acento e em minúsculas.
  key text not null check (length(key) between 3 and 300),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  source text not null check (source in ('cliente', 'ajuste')),
  updated_at timestamptz not null default now(),
  primary key (pizzeria_id, key)
);

-- Só o servidor lê e grava (com a chave secreta).
alter table public.address_points enable row level security;
revoke all on public.address_points from anon, authenticated;
grant all on public.address_points to service_role;
