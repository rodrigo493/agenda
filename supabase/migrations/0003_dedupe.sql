create table if not exists processed_messages (
  message_id text primary key,
  created_at timestamptz not null default now()
);
