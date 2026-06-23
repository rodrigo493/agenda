create table if not exists oauth_state (
  id int primary key default 1 check (id = 1),
  state text not null,
  created_at timestamptz not null default now()
);
