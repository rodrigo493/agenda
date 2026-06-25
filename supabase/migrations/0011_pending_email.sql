create table if not exists pending_email (
  id int primary key default 1 check (id = 1),
  para jsonb not null default '[]'::jsonb,
  assunto text not null default '',
  corpo text not null default '',
  created_at timestamptz not null default now()
);
