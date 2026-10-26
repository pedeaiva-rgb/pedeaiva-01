-- Permissões do gerente, escolhidas pelo dono. O padrão mantém o que o gerente já fazia (tudo, menos a equipe).
-- Com "equipe", o gerente aprova e organiza caixa, atendente, cozinha e entregador (nunca gerente ou dono).

create table public.manager_settings (
  pizzeria_id uuid primary key references public.pizzerias (id) on delete cascade,
  cardapio boolean not null default true,
  cupons boolean not null default true,
  configuracoes boolean not null default true,
  automacoes boolean not null default true,
  estornar boolean not null default true,
  faturamento boolean not null default true,
  equipe boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.manager_settings enable row level security;
grant select on public.manager_settings to authenticated;
grant all on public.manager_settings to service_role;
create policy "equipe ve permissoes do gerente" on public.manager_settings for select to authenticated using (public.is_member(pizzeria_id));

-- Dono sempre pode; gerente, se o dono deixou.
create or replace function public.manager_can(_pz uuid, _perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_pz, '{owner}')
    or (public.has_role(_pz, '{manager}') and coalesce(
         (select (to_jsonb(s) ->> _perm)::boolean from public.manager_settings s where s.pizzeria_id = _pz),
         _perm <> 'equipe'))
$$;

create or replace function public.set_manager_perms(_pz uuid, _perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner}') then raise exception 'Só o dono muda as permissões do gerente' using errcode = '42501'; end if;
  insert into public.manager_settings (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  update public.manager_settings set
    cardapio = coalesce((_perms ->> 'cardapio')::boolean, cardapio),
    cupons = coalesce((_perms ->> 'cupons')::boolean, cupons),
    configuracoes = coalesce((_perms ->> 'configuracoes')::boolean, configuracoes),
    automacoes = coalesce((_perms ->> 'automacoes')::boolean, automacoes),
    estornar = coalesce((_perms ->> 'estornar')::boolean, estornar),
    faturamento = coalesce((_perms ->> 'faturamento')::boolean, faturamento),
    equipe = coalesce((_perms ->> 'equipe')::boolean, equipe),
    updated_at = now()
  where pizzeria_id = _pz;
end $$;

-- ============ CARDÁPIO, ENTREGA, CUPONS, LOJA E AUTOMAÇÕES ============
do $$
declare t text;
begin
  foreach t in array array['categories', 'sizes', 'products', 'product_prices', 'extras'] loop
    execute format('drop policy "gerencia insere" on public.%I', t);
    execute format('drop policy "gerencia edita" on public.%I', t);
    execute format('drop policy "gerencia apaga" on public.%I', t);
    execute format('create policy "gerencia insere" on public.%I for insert to authenticated with check (public.manager_can(pizzeria_id, ''cardapio''))', t);
    execute format('create policy "gerencia edita" on public.%I for update to authenticated using (public.manager_can(pizzeria_id, ''cardapio'')) with check (public.manager_can(pizzeria_id, ''cardapio''))', t);
    execute format('create policy "gerencia apaga" on public.%I for delete to authenticated using (public.manager_can(pizzeria_id, ''cardapio''))', t);
  end loop;
end $$;

drop policy "gerencia insere" on public.delivery_zones;
drop policy "gerencia edita" on public.delivery_zones;
drop policy "gerencia apaga" on public.delivery_zones;
create policy "gerencia insere" on public.delivery_zones for insert to authenticated with check (public.manager_can(pizzeria_id, 'configuracoes'));
create policy "gerencia edita" on public.delivery_zones for update to authenticated
  using (public.manager_can(pizzeria_id, 'configuracoes')) with check (public.manager_can(pizzeria_id, 'configuracoes'));
create policy "gerencia apaga" on public.delivery_zones for delete to authenticated using (public.manager_can(pizzeria_id, 'configuracoes'));

drop policy "gerencia envia fotos" on storage.objects;
drop policy "gerencia troca fotos" on storage.objects;
drop policy "gerencia apaga fotos" on storage.objects;
create policy "gerencia envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.manager_can(public.storage_pizzeria_id(name), 'cardapio'));
create policy "gerencia troca fotos" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.manager_can(public.storage_pizzeria_id(name), 'cardapio'));
create policy "gerencia apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.manager_can(public.storage_pizzeria_id(name), 'cardapio'));

drop policy "gerencia ve cupons" on public.coupons;
drop policy "gerencia cria cupons" on public.coupons;
drop policy "gerencia edita cupons" on public.coupons;
drop policy "gerencia apaga cupons nao usados" on public.coupons;
create policy "gerencia ve cupons" on public.coupons for select to authenticated using (public.manager_can(pizzeria_id, 'cupons'));
create policy "gerencia cria cupons" on public.coupons for insert to authenticated with check (public.manager_can(pizzeria_id, 'cupons') and uses = 0);
create policy "gerencia edita cupons" on public.coupons for update to authenticated
  using (public.manager_can(pizzeria_id, 'cupons')) with check (public.manager_can(pizzeria_id, 'cupons'));
create policy "gerencia apaga cupons nao usados" on public.coupons for delete to authenticated using (public.manager_can(pizzeria_id, 'cupons') and uses = 0);

drop policy "gerencia edita pizzaria" on public.pizzerias;
create policy "gerencia edita pizzaria" on public.pizzerias for update to authenticated
  using (public.manager_can(id, 'configuracoes')) with check (public.manager_can(id, 'configuracoes'));

drop policy "gerencia ve avisos" on public.pizzeria_webhooks;
drop policy "gerencia cria avisos" on public.pizzeria_webhooks;
drop policy "gerencia edita avisos" on public.pizzeria_webhooks;
create policy "gerencia ve avisos" on public.pizzeria_webhooks for select to authenticated using (public.manager_can(pizzeria_id, 'automacoes'));
create policy "gerencia cria avisos" on public.pizzeria_webhooks for insert to authenticated with check (public.manager_can(pizzeria_id, 'automacoes'));
create policy "gerencia edita avisos" on public.pizzeria_webhooks for update to authenticated
  using (public.manager_can(pizzeria_id, 'automacoes')) with check (public.manager_can(pizzeria_id, 'automacoes'));

-- ============ ESTORNO ============
create or replace function public.refund_payment(_order uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o record; rec record; v_note text := left(btrim(coalesce(_reason, '')), 300); approver text;
begin
  select * into o from public.orders where id = _order for update;
  if not found or not public.has_role(o.pizzeria_id, '{owner,manager,cashier}') then
    raise exception 'Somente proprietário, gerente ou caixa (com autorização) pode estornar' using errcode = '42501';
  end if;
  if public.has_role(o.pizzeria_id, '{manager}') and not public.manager_can(o.pizzeria_id, 'estornar') then
    raise exception 'O dono não liberou estorno para o gerente' using errcode = '42501';
  end if;
  if length(v_note) < 3 then raise exception 'Informe o motivo do estorno' using errcode = '22023'; end if;
  if public.has_role(o.pizzeria_id, '{cashier}') then
    approver := public.consume_approval(_order, 'estornar');
    if approver is null then raise exception 'Estorno precisa do PIN do gerente' using errcode = '42501'; end if;
    v_note := left(v_note || ' · autorizado por ' || approver, 300);
  end if;
  select * into rec from public.payments where order_id = _order and kind = 'recebimento';
  if not found then raise exception 'Não há recebimento para estornar' using errcode = '22023'; end if;
  if exists (select 1 from public.payments where reverses_id = rec.id) then
    raise exception 'Este recebimento já foi estornado' using errcode = '22023';
  end if;
  insert into public.payments (pizzeria_id, order_id, kind, method, amount_cents, reverses_id, actor_id, note)
  values (o.pizzeria_id, _order, 'estorno', rec.method, rec.amount_cents, rec.id, auth.uid(), v_note);
  update public.orders set payment_status = 'estornado', updated_at = now() where id = _order;
end $$;

-- Autorizar estorno do caixa: gerente só se puder estornar.
create or replace function public.request_approval(_order uuid, _action text, _pin text)
returns text language plpgsql security definer set search_path = public as $$
declare o record; g record; who record; perm_ok boolean;
begin
  select id, pizzeria_id into o from public.orders where id = _order;
  if not found or not public.is_member(o.pizzeria_id) then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _action not in ('cancelar', 'estornar') then raise exception 'Ação inválida' using errcode = '22023'; end if;
  insert into public.approval_guard (pizzeria_id) values (o.pizzeria_id) on conflict (pizzeria_id) do nothing;
  select * into g from public.approval_guard where pizzeria_id = o.pizzeria_id for update;
  if g.locked_until is not null and g.locked_until > now() then
    raise exception 'Muitas tentativas erradas. Espere alguns minutos.' using errcode = '22023';
  end if;
  perm_ok := _action <> 'estornar' or coalesce((select estornar from public.manager_settings where pizzeria_id = o.pizzeria_id), true);
  select m.user_id, coalesce(m.display_name, split_part(u.email, '@', 1)) as name into who
  from public.members m join public.member_pins p on p.pizzeria_id = m.pizzeria_id and p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.pizzeria_id = o.pizzeria_id and (m.role = 'owner' or (m.role = 'manager' and perm_ok))
    and p.pin_hash = public.member_pin_hash(o.pizzeria_id, m.user_id, coalesce(_pin, ''))
  limit 1;
  if not found then
    update public.approval_guard set
      failures = case when failures + 1 >= 5 then 0 else failures + 1 end,
      locked_until = case when failures + 1 >= 5 then now() + interval '10 minutes' else locked_until end
    where pizzeria_id = o.pizzeria_id;
    raise exception 'PIN de gerente errado.' using errcode = '22023';
  end if;
  update public.approval_guard set failures = 0, locked_until = null where pizzeria_id = o.pizzeria_id;
  insert into public.manager_approvals (pizzeria_id, order_id, action, requested_by, approved_by)
  values (o.pizzeria_id, _order, _action, auth.uid(), who.user_id);
  return who.name;
end $$;

-- ============ EQUIPE PELO GERENTE ============
-- Funções que o gerente pode dar: abaixo dele.
create or replace function public.team_role_ok(_pz uuid, _role public.member_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_pz, '{owner}') or (public.manager_can(_pz, 'equipe') and _role in ('cashier', 'attendant', 'kitchen', 'driver'))
$$;

create or replace function public.team_invite(_pz uuid)
returns table (code text, active boolean) language plpgsql security definer set search_path = public as $$
begin
  if not public.manager_can(_pz, 'equipe') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.team_invites (pizzeria_id) values (_pz) on conflict (pizzeria_id) do nothing;
  return query select t.code, t.active from public.team_invites t where t.pizzeria_id = _pz;
end $$;

create or replace function public.reset_team_invite(_pz uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.manager_can(_pz, 'equipe') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  insert into public.team_invites (pizzeria_id, code) values (_pz, c)
  on conflict (pizzeria_id) do update set code = excluded.code, active = true, updated_at = now();
  return c;
end $$;

create or replace function public.set_team_invite_active(_pz uuid, _active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.manager_can(_pz, 'equipe') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.team_invites set active = _active, updated_at = now() where pizzeria_id = _pz;
end $$;

create or replace function public.approve_join(_request uuid, _role public.member_role)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.join_requests where id = _request for update;
  if not found or not public.manager_can(r.pizzeria_id, 'equipe') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if _role = 'owner' then raise exception 'Escolha uma função da equipe' using errcode = '22023'; end if;
  if not public.team_role_ok(r.pizzeria_id, _role) then raise exception 'O gerente só libera caixa, atendente, cozinha e entregador' using errcode = '42501'; end if;
  if r.status <> 'pendente' then raise exception 'Este pedido já foi respondido' using errcode = '22023'; end if;
  update public.join_requests set status = 'aprovado', role = _role, decided_at = now(), decided_by = auth.uid() where id = _request;
  insert into public.members (pizzeria_id, user_id, role, display_name)
  values (r.pizzeria_id, r.user_id, _role, r.full_name)
  on conflict (pizzeria_id, user_id) do update set role = excluded.role, display_name = excluded.display_name;
end $$;

create or replace function public.reject_join(_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.join_requests where id = _request for update;
  if not found or not public.manager_can(r.pizzeria_id, 'equipe') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if r.status <> 'pendente' then raise exception 'Este pedido já foi respondido' using errcode = '22023'; end if;
  update public.join_requests set status = 'recusado', decided_at = now(), decided_by = auth.uid() where id = _request;
end $$;

create or replace function public.add_member_by_email(_pz uuid, _email text, _role public.member_role, _name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.team_role_ok(_pz, _role) then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(_email));
  if uid is null then
    raise exception 'Nenhuma conta com esse e-mail. Peça para a pessoa se cadastrar primeiro.' using errcode = '22023';
  end if;
  if not public.has_role(_pz, '{owner}') and exists (select 1 from public.members where pizzeria_id = _pz and user_id = uid and role in ('owner', 'manager')) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  insert into public.members (pizzeria_id, user_id, role, display_name)
  values (_pz, uid, _role, nullif(btrim(coalesce(_name, '')), ''))
  on conflict (pizzeria_id, user_id) do update set role = excluded.role, display_name = coalesce(excluded.display_name, public.members.display_name);
end $$;

create or replace function public.team_pins(_pz uuid)
returns table (user_id uuid, has_pin boolean) language plpgsql security definer set search_path = public as $$
begin
  if not public.manager_can(_pz, 'equipe') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return query select m.user_id, exists (select 1 from public.member_pins p where p.pizzeria_id = _pz and p.user_id = m.user_id)
    from public.members m where m.pizzeria_id = _pz;
end $$;

create or replace function public.clear_member_pin(_pz uuid, _user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(_pz, '{owner}') and not (
    public.manager_can(_pz, 'equipe') and exists (select 1 from public.members where pizzeria_id = _pz and user_id = _user and role not in ('owner', 'manager'))
  ) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  delete from public.member_pins where pizzeria_id = _pz and user_id = _user;
end $$;

drop policy "dono e a propria pessoa veem pedidos" on public.join_requests;
create policy "dono e a propria pessoa veem pedidos" on public.join_requests for select to authenticated
  using (user_id = auth.uid() or public.manager_can(pizzeria_id, 'equipe'));

-- Gerente muda a função e remove só quem está abaixo dele (e nunca a si mesmo).
create policy "gerente muda funcao da equipe" on public.members for update to authenticated
  using (public.has_role(pizzeria_id, '{manager}') and public.manager_can(pizzeria_id, 'equipe') and user_id <> auth.uid() and role not in ('owner', 'manager'))
  with check (public.has_role(pizzeria_id, '{manager}') and role not in ('owner', 'manager'));
create policy "gerente remove da equipe" on public.members for delete to authenticated
  using (public.has_role(pizzeria_id, '{manager}') and public.manager_can(pizzeria_id, 'equipe') and user_id <> auth.uid() and role not in ('owner', 'manager'));

revoke execute on function public.manager_can(uuid, text), public.set_manager_perms(uuid, jsonb), public.team_role_ok(uuid, public.member_role),
  public.team_invite(uuid), public.reset_team_invite(uuid), public.set_team_invite_active(uuid, boolean), public.approve_join(uuid, public.member_role),
  public.reject_join(uuid), public.add_member_by_email(uuid, text, public.member_role, text), public.team_pins(uuid), public.clear_member_pin(uuid, uuid),
  public.refund_payment(uuid, text), public.request_approval(uuid, text, text) from public, anon;
grant execute on function public.manager_can(uuid, text), public.set_manager_perms(uuid, jsonb), public.team_role_ok(uuid, public.member_role),
  public.team_invite(uuid), public.reset_team_invite(uuid), public.set_team_invite_active(uuid, boolean), public.approve_join(uuid, public.member_role),
  public.reject_join(uuid), public.add_member_by_email(uuid, text, public.member_role, text), public.team_pins(uuid), public.clear_member_pin(uuid, uuid),
  public.refund_payment(uuid, text), public.request_approval(uuid, text, text) to authenticated;
