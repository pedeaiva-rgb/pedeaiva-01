-- Controle de mesas (parte 1): a função "Garçom" e o canal "Mesa" para as rodadas.
-- Rode este arquivo sozinho e só depois o próximo (o Postgres só usa o valor novo depois de salvo).
alter type public.member_role add value if not exists 'waiter' after 'attendant';
alter type public.order_channel add value if not exists 'mesa';
