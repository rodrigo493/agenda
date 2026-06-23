# Deploy — Agenda WhatsApp

Passo a passo para colocar no ar. Todo o código já está pronto e testado (32/32);
o que falta aqui exige suas chaves/credenciais e algumas ações manuais.

> Ordem importa. Faça de cima para baixo.

---

## 0. Pré-requisitos

- Projeto Supabase criado (anote o **REF** do projeto, ex: `abcdefgh`).
- Instância Uazapi ativa com o WhatsApp conectado.
- Projeto no Google Cloud Console com a **Google Calendar API** habilitada e um
  **OAuth client** (tipo "Web application").
- `ANTHROPIC_API_KEY` válida.
- Supabase CLI logado: `supabase login`.

---

## 1. Fixar (pin) as dependências — COM checagem de segurança

Dois imports usam placeholder/versão aberta e precisam virar versão exata:
- `supabase/functions/_shared/anthropic.ts` → `npm:@anthropic-ai/sdk@VERSAO`
- `supabase/functions/_shared/db.ts` → `npm:@supabase/supabase-js@2`

Para cada pacote, ANTES de fixar (regra de segurança de dependências):

```bash
npm view @anthropic-ai/sdk version          # última versão estável
npm view @anthropic-ai/sdk time --json      # datas de publicação
npm view @supabase/supabase-js version
npm view @supabase/supabase-js time --json
```

- [ ] Versão escolhida tem **mais de 7 dias** de publicação (cooldown).
- [ ] Sem alerta em socket.dev e osv.dev (buscar "<pkg> supply chain attack" últimos 30 dias).
- [ ] Substituir `@VERSAO` e `@2` pelas versões exatas aprovadas (ex: `@0.40.1`, `@2.45.3`).

> Não usar `@latest`, `^` ou `~`. Versão fechada.

---

## 2. Aplicar o schema e popular a config

```bash
supabase link --project-ref <REF>
supabase db push        # aplica 0001_agenda_schema, 0002_pg_cron, 0003_dedupe, 0004_oauth_state
```

> `0002_pg_cron.sql` tem placeholders `<REF>` e `<SERVICE_ROLE_KEY>` — ver passo 7
> (aplicar via SQL Editor, não no db push, OU usar Vault).

Seed da linha de configuração (SQL Editor do projeto). **Sem ela as funções falham.**

```sql
insert into config (id, whatsapp_numero, uazapi_instancia)
values (1, '<SEU_NUMERO_E164_SEM_+>', '<NOME_INSTANCIA_UAZAPI>')
on conflict (id) do update set whatsapp_numero = excluded.whatsapp_numero;
```
Ex.: `whatsapp_numero = '5547999998888'`.

---

## 3. Configurar os segredos das functions

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=<...> \
  UAZAPI_URL=https://<instancia>.uazapi.com \
  UAZAPI_TOKEN=<...> \
  UAZAPI_WEBHOOK_SECRET=<gere_um_segredo_forte> \
  GOOGLE_CLIENT_ID=<...> \
  GOOGLE_CLIENT_SECRET=<...> \
  OAUTH_GATE_SECRET=<gere_outro_segredo_forte>
```

| Segredo | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | classificar mensagens (Claude) |
| `UAZAPI_URL` / `UAZAPI_TOKEN` | enviar mensagens no WhatsApp |
| `UAZAPI_WEBHOOK_SECRET` | **autenticar** o webhook de entrada (anti-spoofing) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | acesso somente-leitura à Google Agenda |
| `OAUTH_GATE_SECRET` | proteger o endpoint de autorização do Google |

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente das functions
> automaticamente — não precisa setar.
>
> Gerar segredos fortes: `openssl rand -base64 32`.

---

## 4. Deploy das Edge Functions

```bash
supabase functions deploy agenda-inbound        --no-verify-jwt
supabase functions deploy agenda-gcal-sync       --no-verify-jwt
supabase functions deploy agenda-reminders       --no-verify-jwt
supabase functions deploy agenda-oauth-callback  --no-verify-jwt
```

---

## 5. Autorizar a Google Agenda (uma vez)

1. No Google Cloud Console → OAuth client → **Authorized redirect URIs**, adicionar:
   `https://<REF>.supabase.co/functions/v1/agenda-oauth-callback`
2. No navegador, abrir:
   `https://<REF>.supabase.co/functions/v1/agenda-oauth-callback?start=1&k=<OAUTH_GATE_SECRET>`
3. Consentir o acesso (escopo somente-leitura).
4. Deve aparecer "✅ Google Agenda conectada!". Confirmar 1 linha em `google_auth`.

---

## 6. Apontar o webhook da Uazapi

Configurar o webhook da instância para (incluindo o token na URL):

`https://<REF>.supabase.co/functions/v1/agenda-inbound?token=<UAZAPI_WEBHOOK_SECRET>`

> Se sua versão da Uazapi permitir header custom, pode mandar o segredo como
> header `x-webhook-token` em vez do `?token=`. A função aceita os dois.

Teste: mandar "ideia: primeiro teste" no WhatsApp → deve responder "💡 Ideia guardada".

---

## 7. Agendar os crons (pg_cron)

Aplicar `supabase/migrations/0002_pg_cron.sql` no SQL Editor, substituindo
`<REF>` e `<SERVICE_ROLE_KEY>` (de preferência lendo a key do Vault, não inline).
Confere com:

```sql
select jobname, schedule from cron.job;
-- agenda-gcal-sync  */5 * * * *
-- agenda-reminders  * * * * *
```

---

## 8. Smoke test end-to-end

1. WhatsApp: "ligar pro Victor daqui 12 minutos" → confirma com hora + promessa de lembrete.
2. Esperar ~2 min → chega "⏰ Em ~10 min: ...".
3. "snooze 30min na ligação do Victor" → confirma reagendamento.
4. "o que tenho hoje" → lista a tarefa.
5. "feito ligação do Victor" → confirma e some da lista.
6. Criar reunião com hora no Google daqui ~12 min → em até 5 min entra no cache → ping aos ~10 min.

---

## Resumo dos valores que você precisa preencher

| Placeholder | Onde |
|---|---|
| `<REF>` | ref do projeto Supabase |
| `<SEU_NUMERO_E164_SEM_+>` | seed da `config` (passo 2) |
| `<NOME_INSTANCIA_UAZAPI>` | seed da `config` (passo 2) |
| `UAZAPI_WEBHOOK_SECRET` | segredo gerado (passos 3 e 6) |
| `OAUTH_GATE_SECRET` | segredo gerado (passos 3 e 5) |
| `<SERVICE_ROLE_KEY>` | Supabase → Settings → API (passo 7, via Vault) |
| versões exatas dos 2 SDKs | passo 1 |
