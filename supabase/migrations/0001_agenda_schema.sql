create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('ideia','tarefa')),
  texto text not null,
  due_at timestamptz,
  status text not null default 'aberto' check (status in ('aberto','feito','cancelado')),
  lembrete_enviado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_items_status_due on items (status, due_at);

create table if not exists calendar_events (
  gcal_id text primary key,
  titulo text not null,
  start_at timestamptz not null,
  lembrete_enviado boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists idx_events_start on calendar_events (start_at);

create table if not exists google_auth (
  id int primary key default 1 check (id = 1),
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

create table if not exists config (
  id int primary key default 1 check (id = 1),
  whatsapp_numero text not null,
  uazapi_instancia text not null,
  janela_minutos int not null default 10,
  fuso text not null default 'America/Sao_Paulo'
);
