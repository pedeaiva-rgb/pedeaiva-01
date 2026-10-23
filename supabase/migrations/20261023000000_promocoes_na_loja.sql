-- Cupons em destaque na loja: a gerência escolhe quais aparecem para o cliente.
alter table public.coupons
  add column show_in_store boolean not null default false,
  add column description text not null default '' check (length(description) <= 120);

grant update (show_in_store, description) on public.coupons to authenticated;

-- Vitrine: só cupons marcados para aparecer, ativos, dentro do prazo e com uso disponível.
-- Não expõe contagem de usos nem limite.
create or replace function public.store_coupons(_slug text)
returns table (code text, discount_type public.discount_type, value numeric, min_order_cents integer, ends_at timestamptz, description text)
language sql stable security definer set search_path = public as $$
  select c.code, c.discount_type, c.value, c.min_order_cents, c.ends_at, c.description
  from public.coupons c
  join public.pizzerias z on z.id = c.pizzeria_id
  where z.slug = _slug
    and c.active and c.show_in_store
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at >= now())
    and (c.max_uses is null or c.uses < c.max_uses)
  order by c.created_at desc
  limit 6
$$;
revoke execute on function public.store_coupons(text) from public;
grant execute on function public.store_coupons(text) to anon, authenticated;
