import type { Intent } from './types.ts';

export function buildClassifyPrompt(
  message: string, nowISO: string, tz: string,
): { system: string; user: string } {
  const system = [
    'Você classifica mensagens de WhatsApp de uma agenda pessoal.',
    'Responda APENAS com um objeto JSON, sem texto em volta, com um campo "kind":',
    '- {"kind":"ideia","texto":string}',
    '- {"kind":"tarefa","texto":string,"due_at":string|null,"convidados":string[],"video":boolean}',
    '   (due_at em ISO 8601 UTC com Z, null se sem hora; convidados = e-mails citados, [] se nenhum;',
    '    video = true se pedir chamada de vídeo / videochamada / Google Meet / link de reunião)',
    '- {"kind":"listar","escopo":"hoje"|"abertos"}',
    '- {"kind":"feito","referencia":string}      (referencia = trecho do texto da tarefa)',
    '- {"kind":"cancelar","referencia":string}',
    '- {"kind":"reagendar","referencia":string,"due_at":string|null,"delta_min":number|null}',
    'No campo "texto" coloque APENAS o assunto curto e limpo (ex: "Reunião com o Victor", "Ligar pro João"),',
    'SEM palavras de comando ("marcar", "criar evento", "agendar", "lembra de"), SEM a data/hora, SEM e-mails',
    'e SEM "com vídeo". Ex: "marcar reunião com o Victor amanhã 15h com vídeo e convidar a@x.com"',
    '→ texto:"Reunião com o Victor", convidados:["a@x.com"], video:true.',
    'Para datas/horas relativas ("hoje", "amanhã 15h", "sexta de manhã", "daqui 1h"), use SEMPRE a',
    'data/hora LOCAL do usuário (linha "agora (local)") como referência — NUNCA a data UTC, pois à noite',
    'o UTC já pode estar no dia seguinte. Ex: se "agora (local)" é 23/06 23h, então "hoje" = 23/06.',
    'Calcule o instante absoluto e devolva em UTC (ISO com Z). Para "snooze"/"adia X min/h" use delta_min.',
    'Se não tiver certeza do que é, responda {"kind":"desconhecido"}.',
  ].join('\n');

  const local = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, dateStyle: 'full', timeStyle: 'short',
  }).format(new Date(nowISO));

  const user = [
    `agora (local, ${tz}): ${local}`,
    `agora (UTC): ${nowISO}`,
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
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return unknown;
    try { obj = JSON.parse(m[0]); } catch { return unknown; }
  }
  if (typeof obj !== 'object' || obj === null) return unknown;
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
  const dateOrNull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0);

  switch (o.kind) {
    case 'ideia':
      return str(o.texto) ? { kind: 'ideia', texto: o.texto } : unknown;
    case 'tarefa': {
      if (!str(o.texto) || !dateOrNull(o.due_at)) return unknown;
      const convidados = Array.isArray(o.convidados)
        ? o.convidados.filter((x): x is string => typeof x === 'string' && x.includes('@'))
        : [];
      return { kind: 'tarefa', texto: o.texto, due_at: o.due_at, convidados, video: o.video === true };
    }
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
