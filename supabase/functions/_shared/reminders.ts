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
