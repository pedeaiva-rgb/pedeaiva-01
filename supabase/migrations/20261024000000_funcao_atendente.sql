-- Nova função "Atendente", separada do Caixa: atende e lança pedidos, mas não registra recebimento.
-- Rode este arquivo sozinho e só depois o próximo (o Postgres só usa o valor novo depois de salvo).
alter type public.member_role add value if not exists 'attendant' after 'cashier';
