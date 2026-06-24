create table if not exists pending_event (
  id int primary key default 1 check (id = 1),
  titulo text not null,
  due_at timestamptz not null,
  convidados jsonb not null default '[]'::jsonb,
  video boolean not null default false,
  created_at timestamptz not null default now()
);
