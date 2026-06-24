import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifyPrompt, parseIntent } from '../supabase/functions/_shared/classify.ts';

test('buildClassifyPrompt injeta now, fuso e a mensagem', () => {
  const p = buildClassifyPrompt('ligar pro Victor amanhã 15h', '2026-06-19T12:00:00Z', 'America/Sao_Paulo');
  assert.match(p.system, /JSON/);
  assert.match(p.system, /ideia|tarefa|listar|feito|cancelar|reagendar/);
  assert.match(p.user, /Victor/);
  assert.match(p.user, /2026-06-19T12:00:00Z/);
  assert.match(p.user, /America\/Sao_Paulo/);
});

test('parseIntent aceita tarefa válida com due_at', () => {
  const i = parseIntent('{"kind":"tarefa","texto":"ligar Victor","due_at":"2026-06-20T18:00:00Z"}');
  assert.deepEqual(i, { kind: 'tarefa', texto: 'ligar Victor', due_at: '2026-06-20T18:00:00Z', convidados: [], video: false });
});

test('parseIntent extrai convidados (emails) e video', () => {
  const i = parseIntent('{"kind":"tarefa","texto":"reunião","due_at":"2026-06-20T18:00:00Z","convidados":["a@x.com","lixo","b@y.com"],"video":true}');
  assert.deepEqual(i, { kind: 'tarefa', texto: 'reunião', due_at: '2026-06-20T18:00:00Z', convidados: ['a@x.com', 'b@y.com'], video: true });
});

test('parseIntent aceita ideia', () => {
  assert.deepEqual(parseIntent('{"kind":"ideia","texto":"carrossel joelho"}'),
    { kind: 'ideia', texto: 'carrossel joelho' });
});

test('parseIntent aceita reagendar com delta', () => {
  assert.deepEqual(
    parseIntent('{"kind":"reagendar","referencia":"ligar Victor","due_at":null,"delta_min":60}'),
    { kind: 'reagendar', referencia: 'ligar Victor', due_at: null, delta_min: 60 });
});

test('parseIntent: JSON inválido vira desconhecido', () => {
  assert.deepEqual(parseIntent('isso não é json'), { kind: 'desconhecido' });
});

test('parseIntent: kind desconhecido vira desconhecido', () => {
  assert.deepEqual(parseIntent('{"kind":"foobar"}'), { kind: 'desconhecido' });
});

test('parseIntent: tarefa sem texto vira desconhecido', () => {
  assert.deepEqual(parseIntent('{"kind":"tarefa","due_at":null}'), { kind: 'desconhecido' });
});

test('parseIntent: extrai JSON mesmo com texto em volta', () => {
  const i = parseIntent('Claro! {"kind":"ideia","texto":"x"} pronto');
  assert.deepEqual(i, { kind: 'ideia', texto: 'x' });
});

test('parseIntent aceita listar', () => {
  assert.deepEqual(parseIntent('{"kind":"listar","escopo":"hoje"}'),
    { kind: 'listar', escopo: 'hoje' });
});

test('parseIntent aceita feito', () => {
  assert.deepEqual(parseIntent('{"kind":"feito","referencia":"ligar Victor"}'),
    { kind: 'feito', referencia: 'ligar Victor' });
});

test('parseIntent aceita cancelar', () => {
  assert.deepEqual(parseIntent('{"kind":"cancelar","referencia":"reunião X"}'),
    { kind: 'cancelar', referencia: 'reunião X' });
});
