create table if not exists last_image (
  id int primary key default 1 check (id = 1),
  aba text not null,
  col text not null,
  "row" int not null,
  created_at timestamptz not null default now()
);
