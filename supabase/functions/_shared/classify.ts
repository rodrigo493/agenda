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
