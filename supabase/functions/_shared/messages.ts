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
