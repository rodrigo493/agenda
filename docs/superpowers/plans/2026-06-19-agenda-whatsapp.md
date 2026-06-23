# Agenda WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma agenda pessoal operada pelo WhatsApp — captura ideias/tarefas em linguagem natural e dispara lembretes 10 min antes de reuniões do Google Agenda e tarefas com hora.

**Architecture:** Supabase como backbone. Quatro Edge Functions (Deno): `agenda-inbound` (webhook Uazapi → Claude classifica → grava), `agenda-gcal-sync` (pg_cron 5 min → cache do Google Agenda), `agenda-reminders` (pg_cron 1 min → dispara lembretes), `agenda-oauth-callback` (autorização Google única). Toda a lógica pura (datas, janela de lembrete, parse da intenção, textos) vive em `_shared/` como módulos TypeScript puros, testados com `node --test`. As funções são wrappers finos de I/O.

**Tech Stack:** Supabase (Postgres + Edge Functions/Deno + pg_cron), Anthropic API (`claude-haiku-4-5`), Uazapi (WhatsApp), Google Calendar API v3 (somente leitura), Node 24 (test runner nativo, roda `.ts`).

## Global Constraints

- **Fuso oficial:** `America/Sao_Paulo`. Todo `due_at`/`start_at` é gravado em UTC (ISO com `Z`); formatação para o usuário sempre converte para esse fuso.
- **Janela de lembrete:** 10 minutos (lido de `config.janela_minutos`, default 10).
- **Modelo Claude:** `claude-haiku-4-5` (string exata, sem sufixo de data). Troca de modelo é decisão do usuário.
- **Google:** escopo somente leitura `https://www.googleapis.com/auth/calendar.readonly`. O bot nunca cria/edita/apaga eventos do Google.
- **Conta única (v1):** rodrigo@liveequipamentos.com.br. Sem multiusuário.
- **Idempotência:** todo lembrete marca `lembrete_enviado=true` após envio; nunca duplica.
- **Segredos:** `ANTHROPIC_API_KEY`, `UAZAPI_URL`, `UAZAPI_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` — apenas em secrets/env. Nunca commitar. `.env` está no `.gitignore`.
- **Dependências:** nenhuma lib nova nos módulos puros (só APIs nativas: `Intl`, `fetch`, `Date`). Edge Functions importam `@anthropic-ai/sdk` e `@supabase/supabase-js` via `npm:` com versão **fixada**; antes de fixar a versão, validar cooldown de 7 dias + socket.dev/osv.dev (regra de segurança de dependências do usuário).
- **No status enum:** `items.status ∈ {aberto, feito, cancelado}`; `items.tipo ∈ {ideia, tarefa}`.

---

## File Structure

```
Agenda/
├── package.json                         # type:module, script de teste (node --test)
├── .gitignore                           # já existe (.env, node_modules, *.pem...)
├── supabase/
│   ├── config.toml                      # supabase init
│   ├── migrations/
│   │   ├── 0001_agenda_schema.sql       # tabelas + índices
│   │   └── 0002_pg_cron.sql             # agendamentos cron (Task 10)
│   └── functions/
│       ├── _shared/
│       │   ├── types.ts                 # Intent, Item, CalendarEvent, ReminderTarget
│       │   ├── datetime.ts              # addMinutes, isWithinWindow, resolveReschedule, formatLocal
│       │   ├── reminders.ts             # selectReminders
│       │   ├── classify.ts              # buildClassifyPrompt, parseIntent
│       │   ├── messages.ts              # textos de confirmação/lembrete/lista
│       │   ├── db.ts                    # helpers Supabase (I/O)
│       │   ├── uazapi.ts                # enviarWhatsApp (I/O)
│       │   ├── gcal.ts                  # accessTokenFromRefresh, listarEventos (I/O)
│       │   └── anthropic.ts             # classificarMensagem (I/O, usa classify.ts)
│       ├── agenda-inbound/index.ts
│       ├── agenda-gcal-sync/index.ts
│       ├── agenda-reminders/index.ts
│       └── agenda-oauth-callback/index.ts
└── tests/
    ├── datetime.test.ts
    ├── reminders.test.ts
    ├── classify.test.ts
    └── messages.test.ts
```

**Camada pura (testável sem infra):** `types.ts`, `datetime.ts`, `reminders.ts`, `classify.ts`, `messages.ts`.
**Camada de I/O (smoke test):** `db.ts`, `uazapi.ts`, `gcal.ts`, `anthropic.ts`, e os quatro `index.ts`.

---

### Task 1: Scaffold do projeto + schema + harness de teste

**Files:**
- Create: `package.json`
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/0001_agenda_schema.sql`
- Create: `supabase/functions/_shared/types.ts`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Produces: tipos compartilhados consumidos por todas as tasks seguintes:
  - `Intent` (union), `Item`, `CalendarEvent`, `ReminderTarget` (assinaturas no Step 4).

- [ ] **Step 1: Inicializar Supabase e package.json**

Run:
```bash
cd /c/VS_CODE/Agenda
supabase init
```
Quando perguntar sobre VS Code settings/Deno, responda `n`.

Create `package.json`:
```json
{
  "name": "agenda-whatsapp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/datetime.test.ts tests/reminders.test.ts tests/classify.test.ts tests/messages.test.ts"
  }
}
```

- [ ] **Step 2: Escrever o smoke test (falha primeiro)**

Create `tests/smoke.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item } from '../supabase/functions/_shared/types.ts';

test('tipos compartilhados carregam e Item tem o shape esperado', () => {
  const item: Item = {
    id: 'x', tipo: 'tarefa', texto: 'teste', due_at: null,
    status: 'aberto', lembrete_enviado: false, created_at: '2026-06-19T00:00:00Z',
  };
  assert.equal(item.tipo, 'tarefa');
});
```

- [ ] **Step 3: Rodar o teste e confirmar que FALHA**

Run: `node --test tests/smoke.test.ts`
Expected: FAIL — `Cannot find module '.../_shared/types.ts'`.

- [ ] **Step 4: Criar os tipos compartilhados**

Create `supabase/functions/_shared/types.ts`:
```ts
export type Intent =
  | { kind: 'ideia'; texto: string }
  | { kind: 'tarefa'; texto: string; due_at: string | null }
  | { kind: 'listar'; escopo: 'hoje' | 'abertos' }
  | { kind: 'feito'; referencia: string }
  | { kind: 'cancelar'; referencia: string }
  | { kind: 'reagendar'; referencia: string; due_at: string | null; delta_min: number | null }
  | { kind: 'desconhecido' };

export interface Item {
  id: string;
  tipo: 'ideia' | 'tarefa';
  texto: string;
  due_at: string | null;          // ISO UTC, só tarefa com hora
  status: 'aberto' | 'feito' | 'cancelado';
  lembrete_enviado: boolean;
  created_at: string;             // ISO UTC
}

export interface CalendarEvent {
  gcal_id: string;
  titulo: string;
  start_at: string;               // ISO UTC
  lembrete_enviado: boolean;
}

export interface ReminderTarget {
  tipo: 'reuniao' | 'tarefa';
  id: string;                     // gcal_id ou item.id
  titulo: string;
  start_at: string;               // ISO UTC
}
```

- [ ] **Step 5: Rodar o teste e confirmar que PASSA**

Run: `node --test tests/smoke.test.ts`
Expected: PASS.

- [ ] **Step 6: Criar a migration do schema**

Create `supabase/migrations/0001_agenda_schema.sql`:
```sql
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
```

- [ ] **Step 7: Commit**

```bash
git add package.json supabase tests/smoke.test.ts
git commit -m "feat: scaffold supabase, schema e tipos compartilhados"
```

---

### Task 2: `datetime.ts` — aritmética de tempo e fuso (TDD puro)

**Files:**
- Create: `supabase/functions/_shared/datetime.ts`
- Test: `tests/datetime.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `addMinutes(iso: string, minutes: number): string` — ISO UTC + N min.
  - `isWithinWindow(startISO: string, nowISO: string, windowMin: number): boolean` — `now <= start <= now+window`.
  - `resolveReschedule(currentDueAt: string | null, absDueAt: string | null, deltaMin: number | null): string` — absoluto vence; senão soma delta ao atual; erro se ambos nulos/sem base.
  - `formatLocal(iso: string, tz: string): string` — "DD/MM HH:mm" no fuso.

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Create `tests/datetime.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMinutes, isWithinWindow, resolveReschedule, formatLocal }
  from '../supabase/functions/_shared/datetime.ts';

test('addMinutes soma minutos e retorna ISO UTC', () => {
  assert.equal(addMinutes('2026-06-19T12:00:00Z', 90), '2026-06-19T13:30:00.000Z');
  assert.equal(addMinutes('2026-06-19T23:30:00Z', 60), '2026-06-20T00:30:00.000Z');
});

test('isWithinWindow: dentro da janela de 10 min', () => {
  const now = '2026-06-19T12:00:00Z';
  assert.equal(isWithinWindow('2026-06-19T12:09:00Z', now, 10), true);  // 9 min à frente
  assert.equal(isWithinWindow('2026-06-19T12:10:00Z', now, 10), true);  // borda superior
  assert.equal(isWithinWindow('2026-06-19T12:00:00Z', now, 10), true);  // agora
});

test('isWithinWindow: fora da janela', () => {
  const now = '2026-06-19T12:00:00Z';
  assert.equal(isWithinWindow('2026-06-19T12:11:00Z', now, 10), false); // longe demais
  assert.equal(isWithinWindow('2026-06-19T11:59:00Z', now, 10), false); // já passou
});

test('resolveReschedule: absoluto vence', () => {
  assert.equal(
    resolveReschedule('2026-06-19T12:00:00Z', '2026-06-20T13:00:00Z', null),
    '2026-06-20T13:00:00Z',
  );
});

test('resolveReschedule: delta soma sobre o due_at atual (snooze)', () => {
  assert.equal(
    resolveReschedule('2026-06-19T12:00:00Z', null, 60),
    '2026-06-19T13:00:00.000Z',
  );
});

test('resolveReschedule: sem base e sem absoluto lança erro', () => {
  assert.throws(() => resolveReschedule(null, null, 60));
});

test('formatLocal converte UTC para America/Sao_Paulo', () => {
  // 12:00Z = 09:00 em São Paulo (UTC-3)
  assert.equal(formatLocal('2026-06-19T12:00:00Z', 'America/Sao_Paulo'), '19/06 09:00');
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `node --test tests/datetime.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `datetime.ts`**

Create `supabase/functions/_shared/datetime.ts`:
```ts
export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function isWithinWindow(startISO: string, nowISO: string, windowMin: number): boolean {
  const start = new Date(startISO).getTime();
  const now = new Date(nowISO).getTime();
  return start >= now && start <= now + windowMin * 60_000;
}

export function resolveReschedule(
  currentDueAt: string | null,
  absDueAt: string | null,
  deltaMin: number | null,
): string {
  if (absDueAt) return absDueAt;
  if (currentDueAt && deltaMin != null) return addMinutes(currentDueAt, deltaMin);
  throw new Error('reagendar sem data absoluta nem base para delta');
}

export function formatLocal(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `node --test tests/datetime.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/datetime.ts tests/datetime.test.ts
git commit -m "feat: utilitários de data/fuso com testes"
```

---

### Task 3: `reminders.ts` — seleção de lembretes na janela (TDD puro)

**Files:**
- Create: `supabase/functions/_shared/reminders.ts`
- Test: `tests/reminders.test.ts`

**Interfaces:**
- Consumes: `CalendarEvent`, `Item`, `ReminderTarget` de `types.ts`; `isWithinWindow` de `datetime.ts`.
- Produces:
  - `selectReminders(events: CalendarEvent[], tasks: Item[], nowISO: string, windowMin: number): ReminderTarget[]` — eventos e tarefas com `start/due` na janela e `lembrete_enviado=false`. Tarefas precisam de `due_at` não-nulo, `tipo='tarefa'`, `status='aberto'`.

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Create `tests/reminders.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectReminders } from '../supabase/functions/_shared/reminders.ts';
import type { CalendarEvent, Item } from '../supabase/functions/_shared/types.ts';

const now = '2026-06-19T12:00:00Z';

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return { gcal_id: 'g1', titulo: 'Reunião', start_at: '2026-06-19T12:05:00Z', lembrete_enviado: false, ...over };
}
function tk(over: Partial<Item>): Item {
  return { id: 'i1', tipo: 'tarefa', texto: 'Ligar Victor', due_at: '2026-06-19T12:05:00Z',
    status: 'aberto', lembrete_enviado: false, created_at: now, ...over };
}

test('inclui reunião e tarefa dentro da janela', () => {
  const out = selectReminders([ev({})], [tk({})], now, 10);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.tipo).sort(), ['reuniao', 'tarefa']);
});

test('ignora itens já avisados', () => {
  const out = selectReminders([ev({ lembrete_enviado: true })], [tk({ lembrete_enviado: true })], now, 10);
  assert.equal(out.length, 0);
});

test('ignora fora da janela', () => {
  const out = selectReminders([ev({ start_at: '2026-06-19T13:00:00Z' })], [tk({ due_at: '2026-06-19T11:00:00Z' })], now, 10);
  assert.equal(out.length, 0);
});

test('ignora tarefa sem due_at, não-aberta, ou que é ideia', () => {
  const semHora = tk({ due_at: null });
  const feita = tk({ status: 'feito' });
  const ideia = tk({ tipo: 'ideia' });
  assert.equal(selectReminders([], [semHora, feita, ideia], now, 10).length, 0);
});

test('ReminderTarget de tarefa carrega texto como título e id do item', () => {
  const [r] = selectReminders([], [tk({ id: 'abc', texto: 'Ligar Victor' })], now, 10);
  assert.deepEqual(r, { tipo: 'tarefa', id: 'abc', titulo: 'Ligar Victor', start_at: '2026-06-19T12:05:00Z' });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `node --test tests/reminders.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `reminders.ts`**

Create `supabase/functions/_shared/reminders.ts`:
```ts
import type { CalendarEvent, Item, ReminderTarget } from './types.ts';
import { isWithinWindow } from './datetime.ts';

export function selectReminders(
  events: CalendarEvent[],
  tasks: Item[],
  nowISO: string,
  windowMin: number,
): ReminderTarget[] {
  const out: ReminderTarget[] = [];

  for (const e of events) {
    if (!e.lembrete_enviado && isWithinWindow(e.start_at, nowISO, windowMin)) {
      out.push({ tipo: 'reuniao', id: e.gcal_id, titulo: e.titulo, start_at: e.start_at });
    }
  }

  for (const t of tasks) {
    if (
      t.tipo === 'tarefa' && t.status === 'aberto' && t.due_at &&
      !t.lembrete_enviado && isWithinWindow(t.due_at, nowISO, windowMin)
    ) {
      out.push({ tipo: 'tarefa', id: t.id, titulo: t.texto, start_at: t.due_at });
    }
  }

  return out;
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `node --test tests/reminders.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/reminders.ts tests/reminders.test.ts
git commit -m "feat: seleção de lembretes na janela com testes"
```

---

### Task 4: `classify.ts` — prompt + parsing da intenção (TDD puro)

**Files:**
- Create: `supabase/functions/_shared/classify.ts`
- Test: `tests/classify.test.ts`

**Interfaces:**
- Consumes: `Intent` de `types.ts`.
- Produces:
  - `buildClassifyPrompt(message: string, nowISO: string, tz: string): { system: string; user: string }` — `system` contém o schema/instrução; `user` é a mensagem + contexto temporal.
  - `parseIntent(raw: string): Intent` — `JSON.parse` + validação. Qualquer erro/shape inválido → `{ kind: 'desconhecido' }`.

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Create `tests/classify.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifyPrompt, parseIntent } from '../supabase/functions/_shared/classify.ts';

test('buildClassifyPrompt injeta now, fuso e a mensagem', () => {
  const p = buildClassifyPrompt('ligar pro Victor amanhã 15h', '2026-06-19T12:00:00Z', 'America/Sao_Paulo');
  assert.match(p.system, /JSON/);
  assert.match(p.system, /ideia|tarefa|listar|feito|cancelar|reagendar/);
  assert.match(p.user, /Victor/);
  assert.match(p.user, /2026-06-19T12:00:00Z/);
  assert.match(p.user, /America\/Sao_Paulo/);
});

test('parseIntent aceita tarefa válida com due_at', () => {
  const i = parseIntent('{"kind":"tarefa","texto":"ligar Victor","due_at":"2026-06-20T18:00:00Z"}');
  assert.deepEqual(i, { kind: 'tarefa', texto: 'ligar Victor', due_at: '2026-06-20T18:00:00Z' });
});

test('parseIntent aceita ideia', () => {
  assert.deepEqual(parseIntent('{"kind":"ideia","texto":"carrossel joelho"}'),
    { kind: 'ideia', texto: 'carrossel joelho' });
});

test('parseIntent aceita reagendar com delta', () => {
  assert.deepEqual(
    parseIntent('{"kind":"reagendar","referencia":"ligar Victor","due_at":null,"delta_min":60}'),
    { kind: 'reagendar', referencia: 'ligar Victor', due_at: null, delta_min: 60 });
});

test('parseIntent: JSON inválido vira desconhecido', () => {
  assert.deepEqual(parseIntent('isso não é json'), { kind: 'desconhecido' });
});

test('parseIntent: kind desconhecido vira desconhecido', () => {
  assert.deepEqual(parseIntent('{"kind":"foobar"}'), { kind: 'desconhecido' });
});

test('parseIntent: tarefa sem texto vira desconhecido', () => {
  assert.deepEqual(parseIntent('{"kind":"tarefa","due_at":null}'), { kind: 'desconhecido' });
});

test('parseIntent: extrai JSON mesmo com texto em volta', () => {
  const i = parseIntent('Claro! {"kind":"ideia","texto":"x"} pronto');
  assert.deepEqual(i, { kind: 'ideia', texto: 'x' });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `node --test tests/classify.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `classify.ts`**

Create `supabase/functions/_shared/classify.ts`:
```ts
import type { Intent } from './types.ts';

export function buildClassifyPrompt(
  message: string, nowISO: string, tz: string,
): { system: string; user: string } {
  const system = [
    'Você classifica mensagens de WhatsApp de uma agenda pessoal.',
    'Responda APENAS com um objeto JSON, sem texto em volta, com um campo "kind":',
    '- {"kind":"ideia","texto":string}',
    '- {"kind":"tarefa","texto":string,"due_at":string|null}  (due_at em ISO 8601 UTC, com Z; null se não houver hora)',
    '- {"kind":"listar","escopo":"hoje"|"abertos"}',
    '- {"kind":"feito","referencia":string}      (referencia = trecho do texto da tarefa)',
    '- {"kind":"cancelar","referencia":string}',
    '- {"kind":"reagendar","referencia":string,"due_at":string|null,"delta_min":number|null}',
    'Para datas/horas relativas ("amanhã 15h", "sexta de manhã", "daqui 1h"), calcule o instante absoluto',
    'usando o agora e o fuso fornecidos e devolva em UTC. Para "snooze"/"adia X min/h" sem nova data, use delta_min.',
    'Se não tiver certeza do que é, responda {"kind":"desconhecido"}.',
  ].join('\n');

  const user = [
    `agora (UTC): ${nowISO}`,
    `fuso do usuário: ${tz}`,
    `mensagem: ${message}`,
  ].join('\n');

  return { system, user };
}

export function parseIntent(raw: string): Intent {
  const unknown: Intent = { kind: 'desconhecido' };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return unknown;
    try { obj = JSON.parse(m[0]); } catch { return unknown; }
  }
  if (typeof obj !== 'object' || obj === null) return unknown;
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const numOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number';
  const dateOrNull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0);

  switch (o.kind) {
    case 'ideia':
      return str(o.texto) ? { kind: 'ideia', texto: o.texto } : unknown;
    case 'tarefa':
      return str(o.texto) && dateOrNull(o.due_at)
        ? { kind: 'tarefa', texto: o.texto, due_at: o.due_at } : unknown;
    case 'listar':
      return o.escopo === 'hoje' || o.escopo === 'abertos'
        ? { kind: 'listar', escopo: o.escopo } : unknown;
    case 'feito':
      return str(o.referencia) ? { kind: 'feito', referencia: o.referencia } : unknown;
    case 'cancelar':
      return str(o.referencia) ? { kind: 'cancelar', referencia: o.referencia } : unknown;
    case 'reagendar':
      return str(o.referencia) && dateOrNull(o.due_at) && numOrNull(o.delta_min)
        ? { kind: 'reagendar', referencia: o.referencia, due_at: o.due_at, delta_min: o.delta_min } : unknown;
    default:
      return unknown;
  }
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `node --test tests/classify.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/classify.ts tests/classify.test.ts
git commit -m "feat: prompt de classificação e parser de intenção com testes"
```

---

### Task 5: `messages.ts` — textos de confirmação/lembrete/lista (TDD puro)

**Files:**
- Create: `supabase/functions/_shared/messages.ts`
- Test: `tests/messages.test.ts`

**Interfaces:**
- Consumes: `Intent`, `Item`, `ReminderTarget` de `types.ts`; `formatLocal` de `datetime.ts`.
- Produces:
  - `textoLembrete(t: ReminderTarget, tz: string): string`
  - `textoLista(items: Item[], tz: string): string`
  - `textoConfirmacao(kind: string, texto: string, dueAtISO: string | null, tz: string): string`
  - `textoReformular(): string`

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Create `tests/messages.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoLembrete, textoLista, textoConfirmacao, textoReformular }
  from '../supabase/functions/_shared/messages.ts';
import type { Item, ReminderTarget } from '../supabase/functions/_shared/types.ts';

const tz = 'America/Sao_Paulo';

test('textoLembrete de reunião cita título e hora local', () => {
  const t: ReminderTarget = { tipo: 'reuniao', id: 'g1', titulo: 'Call Movement', start_at: '2026-06-19T18:00:00Z' };
  const out = textoLembrete(t, tz);
  assert.match(out, /Call Movement/);
  assert.match(out, /15:00/);      // 18:00Z = 15:00 SP
  assert.match(out, /10 min/);
});

test('textoLista numera tarefas com hora e lista ideias', () => {
  const items: Item[] = [
    { id: '1', tipo: 'tarefa', texto: 'Ligar Victor', due_at: '2026-06-19T18:00:00Z', status: 'aberto', lembrete_enviado: false, created_at: '' },
    { id: '2', tipo: 'ideia', texto: 'Carrossel joelho', due_at: null, status: 'aberto', lembrete_enviado: false, created_at: '' },
  ];
  const out = textoLista(items, tz);
  assert.match(out, /1\..*Ligar Victor.*15:00/);
  assert.match(out, /Carrossel joelho/);
});

test('textoLista vazia avisa que não há nada', () => {
  assert.match(textoLista([], tz), /nada/i);
});

test('textoConfirmacao de tarefa com hora promete lembrete', () => {
  const out = textoConfirmacao('tarefa', 'Ligar Victor', '2026-06-19T18:00:00Z', tz);
  assert.match(out, /Ligar Victor/);
  assert.match(out, /15:00/);
  assert.match(out, /lembr/i);
});

test('textoConfirmacao de ideia não promete lembrete', () => {
  const out = textoConfirmacao('ideia', 'Carrossel joelho', null, tz);
  assert.match(out, /Carrossel joelho/);
  assert.doesNotMatch(out, /lembr/i);
});

test('textoReformular pede para reescrever', () => {
  assert.match(textoReformular(), /reformul|entendi|de novo/i);
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `node --test tests/messages.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `messages.ts`**

Create `supabase/functions/_shared/messages.ts`:
```ts
import type { Item, ReminderTarget } from './types.ts';
import { formatLocal } from './datetime.ts';

export function textoLembrete(t: ReminderTarget, tz: string): string {
  const quando = formatLocal(t.start_at, tz);
  const prefixo = t.tipo === 'reuniao' ? '⏰ Em ~10 min: reunião' : '⏰ Em ~10 min:';
  return `${prefixo} "${t.titulo}" (${quando}).`;
}

export function textoLista(items: Item[], tz: string): string {
  if (items.length === 0) return 'Não há nada na sua lista. 🎉';
  const tarefas = items.filter((i) => i.tipo === 'tarefa');
  const ideias = items.filter((i) => i.tipo === 'ideia');
  const linhas: string[] = [];
  if (tarefas.length) {
    linhas.push('*Tarefas:*');
    tarefas.forEach((t, n) => {
      const hora = t.due_at ? ` — ${formatLocal(t.due_at, tz)}` : '';
      linhas.push(`${n + 1}. ${t.texto}${hora}`);
    });
  }
  if (ideias.length) {
    linhas.push('*Ideias:*');
    ideias.forEach((i) => linhas.push(`• ${i.texto}`));
  }
  return linhas.join('\n');
}

export function textoConfirmacao(
  kind: string, texto: string, dueAtISO: string | null, tz: string,
): string {
  switch (kind) {
    case 'tarefa':
      return dueAtISO
        ? `✅ Anotado: ${texto} (${formatLocal(dueAtISO, tz)}). Te lembro ~10 min antes.`
        : `✅ Anotado: ${texto}.`;
    case 'ideia':
      return `💡 Ideia guardada: ${texto}.`;
    case 'feito':
      return `✔️ Marquei como feito: ${texto}.`;
    case 'cancelar':
      return `🗑️ Cancelado: ${texto}.`;
    case 'reagendar':
      return dueAtISO
        ? `🔁 Reagendado: ${texto} para ${formatLocal(dueAtISO, tz)}.`
        : `🔁 Reagendado: ${texto}.`;
    default:
      return `Ok: ${texto}.`;
  }
}

export function textoReformular(): string {
  return 'Não entendi bem 🤔. Pode reformular? Ex: "ligar pro Victor amanhã 15h" ou "ideia: ..."';
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `node --test tests/messages.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — todos os arquivos (datetime, reminders, classify, messages).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/messages.ts tests/messages.test.ts
git commit -m "feat: textos de confirmação, lembrete e lista com testes"
```

---

### Task 6: Adaptadores de I/O (`db.ts`, `uazapi.ts`, `gcal.ts`, `anthropic.ts`)

> Wrappers finos sobre serviços externos. Não têm teste unitário (I/O puro); são exercitados pelos smoke tests das Tasks 7–10. Mantenha-os pequenos — toda decisão de negócio já está nas Tasks 2–5.

**Files:**
- Create: `supabase/functions/_shared/db.ts`
- Create: `supabase/functions/_shared/uazapi.ts`
- Create: `supabase/functions/_shared/gcal.ts`
- Create: `supabase/functions/_shared/anthropic.ts`

**Interfaces:**
- Consumes: `classify.ts` (`buildClassifyPrompt`, `parseIntent`), `types.ts`.
- Produces (assinaturas usadas pelas funções):
  - db: `getClient()`, `getConfig()`, `inserirItem(...)`, `buscarItens(escopo)`, `marcarStatus(referencia, status)`, `reagendarItem(referencia, novoDueAt)`, `eventosNaJanela()`, `tarefasNaJanela()`, `marcarLembreteEvento(id)`, `marcarLembreteTarefa(id)`, `upsertEvento(ev)`, `getRefreshToken()`, `salvarRefreshToken(token)`.
  - uazapi: `enviarWhatsApp(numero: string, texto: string): Promise<void>`.
  - gcal: `accessTokenFromRefresh(refresh: string): Promise<string>`, `listarEventos(accessToken: string): Promise<CalendarEvent[]>`.
  - anthropic: `classificarMensagem(message: string, nowISO: string, tz: string): Promise<Intent>`.

- [ ] **Step 1: `db.ts` — cliente Supabase + queries**

Create `supabase/functions/_shared/db.ts`:
```ts
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CalendarEvent, Item } from './types.ts';

export function getClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export async function getConfig(db: SupabaseClient) {
  const { data, error } = await db.from('config').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as { whatsapp_numero: string; uazapi_instancia: string; janela_minutos: number; fuso: string };
}

export async function inserirItem(
  db: SupabaseClient, tipo: 'ideia' | 'tarefa', texto: string, due_at: string | null,
): Promise<void> {
  const { error } = await db.from('items').insert({ tipo, texto, due_at });
  if (error) throw error;
}

export async function buscarItens(db: SupabaseClient, escopo: 'hoje' | 'abertos'): Promise<Item[]> {
  let q = db.from('items').select('*').eq('status', 'aberto').order('due_at', { ascending: true, nullsFirst: false });
  const { data, error } = await q;
  if (error) throw error;
  let items = (data ?? []) as Item[];
  if (escopo === 'hoje') {
    const hoje = new Date().toISOString().slice(0, 10);
    items = items.filter((i) => i.due_at?.slice(0, 10) === hoje);
  }
  return items;
}

// Casa a referência textual com a tarefa aberta mais recente que contém o trecho.
async function acharTarefa(db: SupabaseClient, referencia: string): Promise<Item | null> {
  const { data, error } = await db.from('items').select('*')
    .eq('status', 'aberto').ilike('texto', `%${referencia}%`)
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as Item) ?? null;
}

export async function marcarStatus(
  db: SupabaseClient, referencia: string, status: 'feito' | 'cancelado',
): Promise<Item | null> {
  const alvo = await acharTarefa(db, referencia);
  if (!alvo) return null;
  const { error } = await db.from('items').update({ status }).eq('id', alvo.id);
  if (error) throw error;
  return alvo;
}

export async function reagendarItem(
  db: SupabaseClient, referencia: string, novoDueAt: string,
): Promise<Item | null> {
  const alvo = await acharTarefa(db, referencia);
  if (!alvo) return null;
  const { error } = await db.from('items')
    .update({ due_at: novoDueAt, lembrete_enviado: false }).eq('id', alvo.id);
  if (error) throw error;
  return { ...alvo, due_at: novoDueAt };
}

export async function eventosNaJanela(db: SupabaseClient, ateISO: string): Promise<CalendarEvent[]> {
  const { data, error } = await db.from('calendar_events').select('*')
    .eq('lembrete_enviado', false).lte('start_at', ateISO).gte('start_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

export async function tarefasNaJanela(db: SupabaseClient, ateISO: string): Promise<Item[]> {
  const { data, error } = await db.from('items').select('*')
    .eq('tipo', 'tarefa').eq('status', 'aberto').eq('lembrete_enviado', false)
    .not('due_at', 'is', null).lte('due_at', ateISO).gte('due_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []) as Item[];
}

export async function marcarLembreteEvento(db: SupabaseClient, gcalId: string): Promise<void> {
  await db.from('calendar_events').update({ lembrete_enviado: true }).eq('gcal_id', gcalId);
}
export async function marcarLembreteTarefa(db: SupabaseClient, id: string): Promise<void> {
  await db.from('items').update({ lembrete_enviado: true }).eq('id', id);
}

export async function upsertEvento(db: SupabaseClient, ev: { gcal_id: string; titulo: string; start_at: string }): Promise<void> {
  // Se o horário mudou, reseta lembrete_enviado para reavisar.
  const { data } = await db.from('calendar_events').select('start_at').eq('gcal_id', ev.gcal_id).maybeSingle();
  const horaMudou = data && data.start_at !== ev.start_at;
  const patch: Record<string, unknown> = { ...ev, updated_at: new Date().toISOString() };
  if (horaMudou) patch.lembrete_enviado = false;
  const { error } = await db.from('calendar_events').upsert(patch, { onConflict: 'gcal_id' });
  if (error) throw error;
}

export async function getRefreshToken(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('google_auth').select('refresh_token').eq('id', 1).maybeSingle();
  return data?.refresh_token ?? null;
}
export async function salvarRefreshToken(db: SupabaseClient, token: string): Promise<void> {
  const { error } = await db.from('google_auth')
    .upsert({ id: 1, refresh_token: token, updated_at: new Date().toISOString() });
  if (error) throw error;
}
```

- [ ] **Step 2: `uazapi.ts` — envio de WhatsApp**

Create `supabase/functions/_shared/uazapi.ts`:
```ts
// Envia texto pelo WhatsApp via Uazapi. Endpoint /send/text, header "token".
export async function enviarWhatsApp(numero: string, texto: string): Promise<void> {
  const url = Deno.env.get('UAZAPI_URL')!;        // ex: https://<instancia>.uazapi.com
  const token = Deno.env.get('UAZAPI_TOKEN')!;
  const resp = await fetch(`${url}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!resp.ok) {
    throw new Error(`Uazapi ${resp.status}: ${await resp.text()}`);
  }
}
```

- [ ] **Step 3: `gcal.ts` — token e listagem de eventos**

Create `supabase/functions/_shared/gcal.ts`:
```ts
import type { CalendarEvent } from './types.ts';

export async function accessTokenFromRefresh(refresh: string): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`Google token ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).access_token as string;
}

// Lista eventos das próximas 24h COM horário marcado (ignora all-day: estes vêm com date, não dateTime).
export async function listarEventos(accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const max = new Date(now.getTime() + 24 * 3600_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(), timeMax: max.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
  });
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Google events ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  const out: CalendarEvent[] = [];
  for (const e of json.items ?? []) {
    if (!e.start?.dateTime) continue;   // pula all-day
    out.push({
      gcal_id: e.id, titulo: e.summary ?? '(sem título)',
      start_at: new Date(e.start.dateTime).toISOString(), lembrete_enviado: false,
    });
  }
  return out;
}
```

- [ ] **Step 4: `anthropic.ts` — classificação via SDK**

> Fixe a versão exata do SDK só após validar cooldown 7 dias + socket.dev/osv.dev (regra do usuário). O `@VERSAO` abaixo é placeholder a substituir pela versão aprovada.

Create `supabase/functions/_shared/anthropic.ts`:
```ts
import Anthropic from 'npm:@anthropic-ai/sdk@VERSAO';
import type { Intent } from './types.ts';
import { buildClassifyPrompt, parseIntent } from './classify.ts';

export async function classificarMensagem(
  message: string, nowISO: string, tz: string,
): Promise<Intent> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
  const { system, user } = buildClassifyPrompt(message, nowISO, tz);
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const bloco = resp.content.find((b) => b.type === 'text');
  return parseIntent(bloco && 'text' in bloco ? bloco.text : '');
}
```

- [ ] **Step 5: Verificar que tudo type-checka no Deno**

Run: `supabase functions new _typecheck_tmp` então remova — ou mais simples:
```bash
deno check supabase/functions/_shared/*.ts 2>/dev/null || npx --yes supabase@2.106.0 --version
```
Expected: sem erros de tipo nos módulos `_shared`. (Use o Deno embutido do Supabase CLI: `supabase functions serve` compila ao subir; um erro de tipo apareceria ali.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/db.ts supabase/functions/_shared/uazapi.ts supabase/functions/_shared/gcal.ts supabase/functions/_shared/anthropic.ts
git commit -m "feat: adaptadores de I/O (db, uazapi, gcal, anthropic)"
```

---

### Task 7: Edge Function `agenda-inbound` (webhook do WhatsApp)

**Files:**
- Create: `supabase/functions/agenda-inbound/index.ts`

**Interfaces:**
- Consumes: `db.ts`, `anthropic.ts`, `uazapi.ts`, `messages.ts`, `datetime.ts`.
- Produces: HTTP 200 sempre (Uazapi não precisa de corpo); efeito colateral é gravar item + responder no WhatsApp.

- [ ] **Step 1: Implementar a função**

Create `supabase/functions/agenda-inbound/index.ts`:
```ts
import { getClient, getConfig, inserirItem, buscarItens, marcarStatus, reagendarItem }
  from '../_shared/db.ts';
import { classificarMensagem } from '../_shared/anthropic.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';
import { resolveReschedule } from '../_shared/datetime.ts';
import { textoConfirmacao, textoLista, textoReformular } from '../_shared/messages.ts';

// Extrai (numero, texto) do payload Uazapi. Ignora mensagens enviadas por nós (fromMe).
function extrair(payload: any): { numero: string; texto: string } | null {
  const m = payload?.message ?? payload?.data?.message ?? payload;
  const fromMe = m?.fromMe ?? m?.key?.fromMe ?? false;
  if (fromMe) return null;
  const texto = m?.text ?? m?.body ?? m?.message?.conversation ?? '';
  const numero = m?.sender ?? m?.chatid ?? m?.from ?? m?.key?.remoteJid ?? '';
  if (!texto || !numero) return null;
  return { numero: String(numero), texto: String(texto) };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const msg = extrair(payload);
    if (!msg) return new Response('ignored', { status: 200 });

    const db = getClient();
    const cfg = await getConfig(db);

    // Só responde ao número do dono (segurança: ninguém mais comanda a agenda).
    if (!msg.numero.includes(cfg.whatsapp_numero)) {
      return new Response('not owner', { status: 200 });
    }

    const nowISO = new Date().toISOString();
    const intent = await classificarMensagem(msg.texto, nowISO, cfg.fuso);
    let resposta: string;

    switch (intent.kind) {
      case 'ideia':
        await inserirItem(db, 'ideia', intent.texto, null);
        resposta = textoConfirmacao('ideia', intent.texto, null, cfg.fuso);
        break;
      case 'tarefa':
        await inserirItem(db, 'tarefa', intent.texto, intent.due_at);
        resposta = textoConfirmacao('tarefa', intent.texto, intent.due_at, cfg.fuso);
        break;
      case 'listar': {
        const items = await buscarItens(db, intent.escopo);
        resposta = textoLista(items, cfg.fuso);
        break;
      }
      case 'feito': {
        const alvo = await marcarStatus(db, intent.referencia, 'feito');
        resposta = alvo ? textoConfirmacao('feito', alvo.texto, null, cfg.fuso) : textoReformular();
        break;
      }
      case 'cancelar': {
        const alvo = await marcarStatus(db, intent.referencia, 'cancelado');
        resposta = alvo ? textoConfirmacao('cancelar', alvo.texto, null, cfg.fuso) : textoReformular();
        break;
      }
      case 'reagendar': {
        // precisa do due_at atual para snooze relativo
        const atual = (await buscarItens(db, 'abertos'))
          .find((i) => i.texto.toLowerCase().includes(intent.referencia.toLowerCase()));
        try {
          const novo = resolveReschedule(atual?.due_at ?? null, intent.due_at, intent.delta_min);
          const alvo = await reagendarItem(db, intent.referencia, novo);
          resposta = alvo ? textoConfirmacao('reagendar', alvo.texto, novo, cfg.fuso) : textoReformular();
        } catch {
          resposta = textoReformular();
        }
        break;
      }
      default:
        resposta = textoReformular();
    }

    await enviarWhatsApp(msg.numero, resposta);
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('agenda-inbound erro:', e);
    return new Response('error', { status: 200 }); // 200 evita retry storm da Uazapi
  }
});
```

- [ ] **Step 2: Smoke test local — subir a função**

Run (terminal 1):
```bash
supabase start
supabase functions serve agenda-inbound --no-verify-jwt --env-file ./supabase/.env.local
```
(`./supabase/.env.local` — não commitado — com as 7 variáveis de ambiente.)

- [ ] **Step 3: Smoke test local — enviar payload de ideia**

Run (terminal 2):
```bash
curl -s -X POST http://localhost:54321/functions/v1/agenda-inbound \
  -H 'Content-Type: application/json' \
  -d '{"message":{"sender":"5599999999999","text":"ideia: testar a agenda","fromMe":false}}'
```
Expected: resposta `ok`; logs mostram classificação `ideia`; uma linha nova em `items` (verifique no Studio: http://localhost:54323). Ajuste a função `extrair` se o payload real da sua instância Uazapi diferir (ver memória `project_uazapi_whatsapp_integration`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/agenda-inbound/index.ts
git commit -m "feat: edge function agenda-inbound (webhook WhatsApp)"
```

---

### Task 8: Edge Function `agenda-gcal-sync` (cache do Google Agenda)

**Files:**
- Create: `supabase/functions/agenda-gcal-sync/index.ts`

**Interfaces:**
- Consumes: `db.ts` (`getClient`, `getRefreshToken`, `upsertEvento`), `gcal.ts`, `uazapi.ts`, `db.getConfig`.
- Produces: HTTP 200; efeito é popular/atualizar `calendar_events`.

- [ ] **Step 1: Implementar a função**

Create `supabase/functions/agenda-gcal-sync/index.ts`:
```ts
import { getClient, getConfig, getRefreshToken, upsertEvento } from '../_shared/db.ts';
import { accessTokenFromRefresh, listarEventos } from '../_shared/gcal.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';

Deno.serve(async () => {
  const db = getClient();
  try {
    const refresh = await getRefreshToken(db);
    if (!refresh) return new Response('sem refresh token', { status: 200 });

    let accessToken: string;
    try {
      accessToken = await accessTokenFromRefresh(refresh);
    } catch (e) {
      // token revogado: avisa o dono uma vez (não spammar — só loga + 1 aviso por execução)
      const cfg = await getConfig(db);
      await enviarWhatsApp(cfg.whatsapp_numero,
        '⚠️ Perdi o acesso à sua Google Agenda. Reautorize quando puder.');
      console.error('refresh inválido:', e);
      return new Response('refresh inválido', { status: 200 });
    }

    const eventos = await listarEventos(accessToken);
    for (const ev of eventos) {
      await upsertEvento(db, { gcal_id: ev.gcal_id, titulo: ev.titulo, start_at: ev.start_at });
    }
    return new Response(`sincronizados ${eventos.length}`, { status: 200 });
  } catch (e) {
    console.error('agenda-gcal-sync erro:', e);
    return new Response('error', { status: 200 });
  }
});
```

- [ ] **Step 2: Smoke test local (depois da Task 10 ter o refresh token gravado)**

Run:
```bash
supabase functions serve agenda-gcal-sync --no-verify-jwt --env-file ./supabase/.env.local
curl -s -X POST http://localhost:54321/functions/v1/agenda-gcal-sync
```
Expected: `sincronizados N`; tabela `calendar_events` populada com os eventos com hora das próximas 24h (sem all-day). Se não houver refresh token ainda, retorna `sem refresh token` — normal nesta ordem; revalide após a Task 10.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/agenda-gcal-sync/index.ts
git commit -m "feat: edge function agenda-gcal-sync (cache Google Agenda)"
```

---

### Task 9: Edge Function `agenda-reminders` (relógio de 1 min)

**Files:**
- Create: `supabase/functions/agenda-reminders/index.ts`

**Interfaces:**
- Consumes: `db.ts` (`getClient`, `getConfig`, `eventosNaJanela`, `tarefasNaJanela`, `marcarLembreteEvento`, `marcarLembreteTarefa`), `reminders.ts` (`selectReminders`), `messages.ts` (`textoLembrete`), `uazapi.ts`, `datetime.ts` (`addMinutes`).
- Produces: HTTP 200; efeito é enviar lembretes e marcar `lembrete_enviado`.

- [ ] **Step 1: Implementar a função**

Create `supabase/functions/agenda-reminders/index.ts`:
```ts
import { getClient, getConfig, eventosNaJanela, tarefasNaJanela,
  marcarLembreteEvento, marcarLembreteTarefa } from '../_shared/db.ts';
import { selectReminders } from '../_shared/reminders.ts';
import { textoLembrete } from '../_shared/messages.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';
import { addMinutes } from '../_shared/datetime.ts';

Deno.serve(async () => {
  const db = getClient();
  try {
    const cfg = await getConfig(db);
    const nowISO = new Date().toISOString();
    const ateISO = addMinutes(nowISO, cfg.janela_minutos);

    const eventos = await eventosNaJanela(db, ateISO);
    const tarefas = await tarefasNaJanela(db, ateISO);
    const alvos = selectReminders(eventos, tarefas, nowISO, cfg.janela_minutos);

    for (const alvo of alvos) {
      try {
        await enviarWhatsApp(cfg.whatsapp_numero, textoLembrete(alvo, cfg.fuso));
        if (alvo.tipo === 'reuniao') await marcarLembreteEvento(db, alvo.id);
        else await marcarLembreteTarefa(db, alvo.id);
      } catch (e) {
        // falha de envio: NÃO marca enviado → tenta no próximo ciclo
        console.error('falha ao lembrar', alvo.id, e);
      }
    }
    return new Response(`lembretes: ${alvos.length}`, { status: 200 });
  } catch (e) {
    console.error('agenda-reminders erro:', e);
    return new Response('error', { status: 200 });
  }
});
```

- [ ] **Step 2: Smoke test local — criar tarefa na janela e disparar**

Run:
```bash
# insere uma tarefa que vence em 8 min direto no banco local
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
  -c "insert into items (tipo, texto, due_at) values ('tarefa','smoke lembrete', now() + interval '8 minutes');"
supabase functions serve agenda-reminders --no-verify-jwt --env-file ./supabase/.env.local
curl -s -X POST http://localhost:54321/functions/v1/agenda-reminders
```
Expected: `lembretes: 1`; chega uma mensagem no WhatsApp; a tarefa fica `lembrete_enviado=true`. Rodar o curl de novo → `lembretes: 0` (não duplica).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/agenda-reminders/index.ts
git commit -m "feat: edge function agenda-reminders (relógio de lembretes)"
```

---

### Task 10: OAuth do Google + deploy + pg_cron + smoke end-to-end

**Files:**
- Create: `supabase/functions/agenda-oauth-callback/index.ts`
- Create: `supabase/migrations/0002_pg_cron.sql`

**Interfaces:**
- Consumes: `db.ts` (`getClient`, `salvarRefreshToken`).
- Produces: grava `google_auth.refresh_token`; agenda os dois crons.

- [ ] **Step 1: Implementar o callback OAuth**

Create `supabase/functions/agenda-oauth-callback/index.ts`:
```ts
import { getClient, salvarRefreshToken } from '../_shared/db.ts';

// Fluxo: o dono abre /agenda-oauth-callback?start=1 → redireciona pro consentimento Google.
// Google volta com ?code=... → trocamos por refresh_token e gravamos.
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}${url.pathname}`;
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

  if (url.searchParams.get('start')) {
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', redirectUri);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('access_type', 'offline');
    auth.searchParams.set('prompt', 'consent');
    auth.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
    return Response.redirect(auth.toString(), 302);
  }

  const code = url.searchParams.get('code');
  if (!code) return new Response('faltou code', { status: 400 });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) return new Response(`erro Google: ${await resp.text()}`, { status: 400 });
  const json = await resp.json();
  if (!json.refresh_token) {
    return new Response('Google não retornou refresh_token (revogue o acesso e tente de novo).', { status: 400 });
  }
  await salvarRefreshToken(getClient(), json.refresh_token);
  return new Response('✅ Google Agenda conectada! Pode fechar esta aba.', { status: 200 });
});
```

- [ ] **Step 2: Deploy das funções + secrets (projeto remoto)**

Run:
```bash
supabase link --project-ref <REF_DO_PROJETO>
supabase db push                      # aplica 0001_agenda_schema.sql
supabase secrets set ANTHROPIC_API_KEY=... UAZAPI_URL=... UAZAPI_TOKEN=... \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
supabase functions deploy agenda-inbound --no-verify-jwt
supabase functions deploy agenda-gcal-sync --no-verify-jwt
supabase functions deploy agenda-reminders --no-verify-jwt
supabase functions deploy agenda-oauth-callback --no-verify-jwt
```
(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente das functions; não precisa setar.)

- [ ] **Step 3: Popular `config` e autorizar o Google**

No SQL Editor do projeto:
```sql
insert into config (id, whatsapp_numero, uazapi_instancia)
values (1, '<SEU_NUMERO_E164_SEM_+>', '<NOME_INSTANCIA_UAZAPI>')
on conflict (id) do update set whatsapp_numero = excluded.whatsapp_numero;
```
Registre o redirect URI `https://<REF>.supabase.co/functions/v1/agenda-oauth-callback` no Google Cloud Console (OAuth client). Depois abra no navegador:
`https://<REF>.supabase.co/functions/v1/agenda-oauth-callback?start=1`
→ consinta → deve aparecer "✅ Google Agenda conectada!". Confirme uma linha em `google_auth`.

- [ ] **Step 4: Configurar o webhook na Uazapi**

Aponte o webhook da sua instância Uazapi para:
`https://<REF>.supabase.co/functions/v1/agenda-inbound`
Mande "ideia: primeiro teste" no WhatsApp → deve responder "💡 Ideia guardada".

- [ ] **Step 5: Agendar os crons**

Create `supabase/migrations/0002_pg_cron.sql`:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- substitua <REF> e <SERVICE_ROLE_KEY> ao aplicar (ou use vault)
select cron.schedule('agenda-gcal-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/agenda-gcal-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);

select cron.schedule('agenda-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/agenda-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);
```
Aplique via SQL Editor (substituindo os placeholders). Confirme com `select * from cron.job;`.

- [ ] **Step 6: Smoke end-to-end**

1. WhatsApp: "ligar pro Victor daqui 12 minutos" → confirma com hora + promessa de lembrete.
2. Espere ~2 min → chega "⏰ Em ~10 min: ...".
3. "snooze 30min na ligação do Victor" → confirma reagendamento; lembrete some da janela atual.
4. "o que tenho hoje" → lista a tarefa.
5. "feito ligação do Victor" → confirma e some da lista.
6. Crie uma reunião com hora no Google daqui ~12 min → em até 5 min entra no cache → ping aos ~10 min.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/agenda-oauth-callback/index.ts supabase/migrations/0002_pg_cron.sql
git commit -m "feat: oauth google, deploy e agendamento pg_cron"
```

---

## Self-Review

**1. Spec coverage:**
- Captura linguagem natural → Tasks 4, 6 (anthropic), 7. ✓
- 6 intenções (ideia/tarefa/listar/feito/cancelar/reagendar) → Task 4 (parse) + Task 7 (handlers). ✓
- Reagendar/snooze (absoluto + delta) → Task 2 (`resolveReschedule`) + Task 7. ✓
- Sync Google somente-leitura, ignora all-day → Task 6 (`gcal.ts`) + Task 8. ✓
- Lembrete 10 min reuniões + tarefas, idempotente → Tasks 3, 9. ✓
- OAuth único + aviso de revogação → Task 10 (callback) + Task 8 (aviso). ✓
- Schema (4 tabelas + índices) → Task 1. ✓
- Erros não derrubam o resto / não duplica → Tasks 8, 9 (try/catch por alvo, marca enviado). ✓
- Testes da lógica sensível → Tasks 2–5 (datas/fuso, janela, parse, textos). ✓
- pg_cron 1 min e 5 min → Task 10. ✓

**2. Placeholder scan:** Os únicos placeholders são valores de ambiente intencionais (`<REF>`, `<SERVICE_ROLE_KEY>`, `@VERSAO` do SDK) — substituídos no deploy/instalação, não lógica pendente. Sem "TODO/TBD" em código.

**3. Type consistency:** `Intent`, `Item`, `CalendarEvent`, `ReminderTarget` definidos na Task 1 e usados com os mesmos campos em todas as tasks. `selectReminders`, `resolveReschedule`, `parseIntent`, `formatLocal`, `enviarWhatsApp`, `classificarMensagem` têm assinatura única consistente entre definição (Tasks 2–6) e uso (Tasks 7–9).

## Riscos conhecidos (do spec)

- **Parsing de datas relativas PT-BR**: mitigado por confirmação imediata no WhatsApp (você corrige na hora) + testes de `parseIntent`. A precisão da extração de data em si depende do Haiku; se errar muito, subir para `claude-opus-4-8` (troca de 1 linha em `anthropic.ts`).
- **Payload da Uazapi varia por versão**: `extrair()` na Task 7 tem fallbacks; ajustar contra o payload real (memória `project_uazapi_whatsapp_integration`) no smoke da Task 7.
- **Latência do cron de 1 min**: lembrete chega entre ~9 e ~10 min antes — aceitável.
