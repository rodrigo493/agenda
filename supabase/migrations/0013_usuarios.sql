-- Multi-tenant: tabela de usuários (cada pessoa = 1 linha).
create table if not exists usuarios (
  id bigint generated always as identity primary key,
  nome text not null,
  whatsapp text not null unique,
  email text not null,
  sheet_id text,
  fuso text not null default 'America/Sao_Paulo',
  janela_minutos int not null default 10,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed do primeiro usuário (Rodrigo) a partir da config single-tenant atual.
insert into usuarios (nome, whatsapp, email, sheet_id, fuso, janela_minutos)
select 'Rodrigo', whatsapp_numero, 'rodrigo@liveequipamentos.com.br', sheet_ideias_id, fuso, janela_minutos
from config where id = 1
on conflict (whatsapp) do nothing;
