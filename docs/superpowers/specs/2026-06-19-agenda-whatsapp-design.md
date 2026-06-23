# Agenda WhatsApp — Design

**Data:** 2026-06-19
**Autor:** Rodrigo Siqueira (CEO Live Equipamentos) + Claude
**Status:** Aprovado para planejamento

## Objetivo

Uma agenda pessoal operada inteiramente pelo WhatsApp: capturar ideias e
afazeres em linguagem natural com fricção zero, e receber lembretes no WhatsApp
10 minutos antes de reuniões do Google Agenda e de tarefas com horário.

## Escopo (v1)

**Dentro:**
- Captura por linguagem natural via WhatsApp (Claude interpreta).
- 6 intenções entendidas: `ideia`, `tarefa`, `listar`, `feito`, `cancelar`, `reagendar`.
- Reagendar/snooze de tarefa pelo WhatsApp ("adia a ligação do Victor pra
  amanhã 10h", "snooze 1h").
- Sincronização somente-leitura do Google Agenda (1 conta).
- Lembrete 10 min antes de: reuniões com horário marcado + tarefas com hora.
- Confirmação de cada ação de volta no WhatsApp.

**Fora (v2+):**
- Recorrência de tarefas.
- Múltiplas agendas Google / multiusuário.
- Reagendar eventos do Google pelo WhatsApp (v1 é somente-leitura do Google;
  snooze vale só para tarefas próprias).
- Web app de visualização (pode vir depois, dados já ficam prontos).

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Interface | WhatsApp-first, sem tela na v1 |
| Entendimento | Linguagem natural, Claude classifica e extrai data/hora |
| O que avisa | Eventos do Google **com horário marcado** (ignora dia-todo) + tarefas com hora |
| Conta Google | rodrigo@liveequipamentos.com.br, escopo somente-leitura, autorização única (OAuth refresh token) |
| Hospedagem | Supabase: Edge Functions + pg_cron (mesmo padrão do LiveCRM) |
| WhatsApp | Uazapi (instância já existente) |
| Fuso | America/Sao_Paulo |
| Janela de lembrete | 10 minutos |

## Arquitetura

```
Você (WhatsApp) ──▶ Uazapi ──▶ [agenda-inbound] ──▶ Claude classifica ──▶ Supabase
                                                                            │
Google Agenda ◀── [agenda-gcal-sync] a cada 5 min ──────────────────────────┤
                                                                            │
   pg_cron 1 min ──▶ [agenda-reminders]: reunião/tarefa nos próximos 10 min?─┘
                              │
                              ▼
                       Uazapi ──▶ ping no WhatsApp
```

Três Edge Functions + dois jobs pg_cron + um endpoint OAuth.

### Componentes

1. **`agenda-inbound`** (Edge Function, webhook Uazapi)
   - Recebe mensagem do WhatsApp.
   - Chama Claude com a mensagem + data/hora atual + fuso → retorna intenção
     estruturada (JSON): `{tipo, texto, due_at?, alvo?}`.
   - Intenções:
     - `ideia` → grava `items(tipo=ideia)`.
     - `tarefa` → grava `items(tipo=tarefa, due_at?)`.
     - `listar` → busca itens (hoje / abertos) e responde a lista.
     - `feito` → marca item como `status=feito` (casa por referência textual/índice).
     - `cancelar` → marca item como `status=cancelado`.
     - `reagendar` → atualiza `due_at` da tarefa (data absoluta "amanhã 10h" ou
       relativa "snooze 1h", calculada sobre o `due_at` atual) e **reseta
       `lembrete_enviado=false`** para o novo lembrete disparar. Só tarefas
       próprias; evento do Google não é alterado.
   - Responde confirmação no WhatsApp via Uazapi.
   - Se Claude não tiver confiança, pede para reformular (não inventa).

2. **`agenda-gcal-sync`** (Edge Function, pg_cron a cada 5 min)
   - Usa refresh token de `google_auth` para obter access token.
   - Lista eventos das próximas ~24h com horário marcado (filtra dia-todo).
   - Upsert em `calendar_events` por `gcal_id` (atualiza título/hora se mudaram;
     reseta `lembrete_enviado` se o horário mudou).

3. **`agenda-reminders`** (Edge Function, pg_cron a cada 1 min)
   - Reuniões: `calendar_events` com `start_at` entre agora e +10min e
     `lembrete_enviado=false` → envia, marca enviado.
   - Tarefas: `items(tipo=tarefa, status=aberto, due_at)` na mesma janela e
     `lembrete_enviado=false` → envia, marca enviado.
   - Idempotente: marcar "enviado" garante não-duplicação mesmo com atraso do cron.

4. **`agenda-oauth-callback`** (Edge Function, HTTP)
   - Recebe o `code` do consentimento Google, troca por refresh token, grava em
     `google_auth`. Usado uma vez na configuração; reusável se houver revogação.

## Modelo de dados

```sql
-- items: ideias e tarefas
items (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('ideia','tarefa')),
  texto         text not null,
  due_at        timestamptz,                 -- só tarefa com hora
  status        text not null default 'aberto'
                check (status in ('aberto','feito','cancelado')),
  lembrete_enviado boolean not null default false,
  created_at    timestamptz not null default now()
)

-- calendar_events: cache do Google Agenda
calendar_events (
  gcal_id       text primary key,
  titulo        text not null,
  start_at      timestamptz not null,
  lembrete_enviado boolean not null default false,
  updated_at    timestamptz not null default now()
)

-- google_auth: token (1 linha)
google_auth (
  id            int primary key default 1 check (id = 1),
  refresh_token text not null,
  updated_at    timestamptz not null default now()
)

-- config: parâmetros (1 linha)
config (
  id              int primary key default 1 check (id = 1),
  whatsapp_numero text not null,
  uazapi_instancia text not null,
  janela_minutos  int not null default 10,
  fuso            text not null default 'America/Sao_Paulo'
)
```

Índices: `items(status, due_at)`, `calendar_events(start_at)`.

## Tratamento de erros

- **Claude sem confiança / mensagem ambígua** → responde pedindo reformulação;
  nunca grava palpite.
- **Uazapi indisponível** no envio → loga, item permanece `lembrete_enviado=false`
  e tenta no próximo ciclo de 1 min.
- **Google indisponível / token revogado** → loga; se token inválido, envia 1
  aviso no WhatsApp pedindo reautorização (link), sem spammar.
- **Webhook duplicado da Uazapi** → dedupe por message id.
- Falha em um componente não derruba os outros (sync separado de lembrete).

## Testes (TDD)

- **Classificador:** mensagem → `{tipo, due_at}` corretos, incluindo datas
  relativas ("amanhã 15h", "sexta de manhã") no fuso certo.
- **Lembrete:** janela de 10 min (inclui/exclui bordas), não-duplicação,
  conversão de fuso, dia-todo ignorado.
- **Reagendar:** "snooze 1h" soma sobre `due_at` atual; data absoluta substitui;
  `lembrete_enviado` volta a `false`.
- **Inbound (integração):** payload real Uazapi → grava item certo → responde.
- **gcal-sync:** upsert por `gcal_id`, reset de `lembrete_enviado` em mudança de hora.

## Segredos (nunca commitar)

`ANTHROPIC_API_KEY`, `UAZAPI_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`, `SUPABASE_SERVICE_ROLE`
— todos em variáveis de ambiente / secrets do Supabase.

## Riscos

- **Parsing de datas relativas em PT-BR** é a parte mais sensível — coberta por
  testes dedicados, e a confirmação no WhatsApp deixa você corrigir na hora.
- **Latência do cron de 1 min**: lembrete pode chegar entre 9 e 10 min antes, não
  exatamente 10:00 — aceitável.
