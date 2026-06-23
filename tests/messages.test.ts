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

test('textoConfirmacao de tarefa SEM hora não promete lembrete', () => {
  const out = textoConfirmacao('tarefa', 'Comprar café', null, tz);
  assert.match(out, /Comprar café/);
  assert.doesNotMatch(out, /lembr/i);
});

test('textoLista só com ideias não mostra cabeçalho de Tarefas', () => {
  const items = [
    { id: '1', tipo: 'ideia', texto: 'Ideia A', due_at: null, status: 'aberto', lembrete_enviado: false, created_at: '' } as any,
  ];
  const out = textoLista(items, tz);
  assert.match(out, /Ideia A/);
  assert.doesNotMatch(out, /Tarefas:/);
});

test('textoLembrete de tarefa (não-reunião) não diz "reunião"', () => {
  const t = { tipo: 'tarefa', id: 'i1', titulo: 'Ligar Victor', start_at: '2026-06-19T18:00:00Z' } as any;
  const out = textoLembrete(t, tz);
  assert.match(out, /Ligar Victor/);
  assert.doesNotMatch(out, /reunião/i);
});
