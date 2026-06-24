export type Intent =
  | { kind: 'ideia'; texto: string }
  | { kind: 'tarefa'; texto: string; due_at: string | null; convidados: string[]; video: boolean }
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
