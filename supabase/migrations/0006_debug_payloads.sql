-- TEMPORÁRIO: captura crua de webhooks para depurar a entrega da Uazapi. Remover depois.
create table if not exists debug_payloads (
  id bigint generated always as identity primary key,
  raw text,
  url text,
  has_token_q boolean,
  has_token_h boolean,
  created_at timestamptz not null default now()
);
