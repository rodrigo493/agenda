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
