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
