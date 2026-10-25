-- No Supabase, toda função nova nasce liberada para anon e authenticated; "revoke ... from public" não basta.
-- Fecha o que não é para o visitante (e as internas, que nem a equipe chama direto).

-- Internas: só o banco (gatilhos e outras funções) e o servidor usam.
revoke execute on function public.counter_check_pin(text, uuid, text) from anon, authenticated;
revoke execute on function public.consume_approval(uuid, text) from anon, authenticated;
revoke execute on function public.member_pin_hash(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.kitchen_pin_hash(uuid, text) from anon, authenticated;
revoke execute on function public.couriers_off_duty_when_inactive() from public, anon, authenticated;
revoke execute on function public.reset_store_location() from public, anon, authenticated;

-- Da equipe logada (conferem a função da pessoa por dentro): fora do visitante.
revoke execute on function public.clear_member_pin(uuid, uuid), public.counter_link(uuid), public.kitchen_link(uuid),
  public.my_pin_status(uuid), public.request_approval(uuid, text, text), public.reset_counter_link(uuid),
  public.reset_kitchen_link(uuid), public.set_counter_link(uuid, boolean, integer), public.set_kitchen_link_active(uuid, boolean),
  public.set_kitchen_pin(uuid, text), public.set_my_pin(uuid, text), public.team_pins(uuid) from anon;
