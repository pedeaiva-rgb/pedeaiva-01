-- Avisos automáticos (webhook) para o n8n ou outra automação: pedido criado e mudança de status.
-- O envio é feito pelo pg_net depois que a transação termina; se falhar, o pedido não é afetado.

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponível: os avisos ficam desligados até a extensão ser ativada';
end $$;

create table public.pizzeria_webhooks (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  url text check (url is null or url ~ '^https?://'),
  secret text not null default replace(gen_random_uuid()::text, '-', ''),
  -- Endereço do site, para montar o link de acompanhamento que vai na mensagem.
  site_url text check (site_url is null or site_url ~ '^https?://'),
  active boolean not null default false,
  notify_created boolean not null default true,
  notify_status boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.pizzeria_webhooks enable row level security;
grant select, insert, update on public.pizzeria_webhooks to authenticated;
grant all on public.pizzeria_webhooks to service_role;
create policy "gerencia ve avisos" on public.pizzeria_webhooks for select to authenticated using (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "gerencia cria avisos" on public.pizzeria_webhooks for insert to authenticated with check (public.has_role(pizzeria_id, '{owner,manager}'));
create policy "gerencia edita avisos" on public.pizzeria_webhooks for update to authenticated
  using (public.has_role(pizzeria_id, '{owner,manager}')) with check (public.has_role(pizzeria_id, '{owner,manager}'));

-- Conteúdo do aviso: o que uma mensagem de WhatsApp precisa, sem endereço de entrega.
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
      'link_acompanhamento', coalesce(rtrim(_site_url, '/'), '') || '/pedido/' || o.public_token),
    'cliente', jsonb_build_object(
      'nome', o.customer_name,
      'telefone', nullif(o.customer_phone, ''),
      'whatsapp', case when o.customer_phone <> '' then '55' || o.customer_phone end))
  from public.pizzerias z where z.id = o.pizzeria_id
$$;

create or replace function public.notify_order_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record; ev text; prev public.order_status;
begin
  select * into w from public.pizzeria_webhooks where pizzeria_id = new.pizzeria_id and active and url is not null;
  if not found then return new; end if;
  if tg_op = 'INSERT' then
    if not w.notify_created then return new; end if;
    ev := 'pedido.criado';
  else
    if new.status is not distinct from old.status or not w.notify_status then return new; end if;
    ev := 'pedido.status';
    prev := old.status;
  end if;
  begin
    perform net.http_post(
      url := w.url,
      body := public.order_webhook_payload(ev, new, prev, w.site_url),
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Pede-Ai-Segredo', w.secret));
  exception when others then
    -- Aviso é opcional: nunca impede o pedido de ser criado ou de mudar de status.
    raise warning 'Aviso para automação não enviado: %', sqlerrm;
  end;
  return new;
end $$;

create trigger orders_notify_webhook after insert or update of status on public.orders
  for each row execute function public.notify_order_webhook();

revoke execute on function public.order_webhook_payload(text, public.orders, public.order_status, text) from public, anon, authenticated;
revoke execute on function public.notify_order_webhook() from public, anon, authenticated;
