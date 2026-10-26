-- Quantos lugares tem cada mesa (para saber qual grupo da fila cabe na mesa que liberou).
alter table public.dining_tables add column seats integer check (seats is null or seats between 1 and 99);
