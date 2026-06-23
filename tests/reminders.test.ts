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
