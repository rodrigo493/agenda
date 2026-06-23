import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CalendarEvent, Item } from './types.ts';

export function getClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export async function getConfig(db: SupabaseClient) {
  const { data, error } = await db.from('config').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as { whatsapp_numero: string; uazapi_instancia: string; janela_minutos: number; fuso: string };
}

export async function inserirItem(
  db: SupabaseClient, tipo: 'ideia' | 'tarefa', texto: string, due_at: string | null,
): Promise<void> {
  const { error } = await db.from('items').insert({ tipo, texto, due_at });
  if (error) throw error;
}

export async function buscarItens(db: SupabaseClient, escopo: 'hoje' | 'abertos'): Promise<Item[]> {
  let q = db.from('items').select('*').eq('status', 'aberto').order('due_at', { ascending: true, nullsFirst: false });
  const { data, error } = await q;
  if (error) throw error;
  let items = (data ?? []) as Item[];
  if (escopo === 'hoje') {
    const hoje = new Date().toISOString().slice(0, 10);
    items = items.filter((i) => i.due_at?.slice(0, 10) === hoje);
  }
  return items;
}

// Casa a referência textual com a tarefa aberta mais recente que contém o trecho.
async function acharTarefa(db: SupabaseClient, referencia: string): Promise<Item | null> {
  const { data, error } = await db.from('items').select('*')
    .eq('status', 'aberto').ilike('texto', `%${referencia}%`)
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as Item) ?? null;
}

export async function marcarStatus(
  db: SupabaseClient, referencia: string, status: 'feito' | 'cancelado',
): Promise<Item | null> {
  const alvo = await acharTarefa(db, referencia);
  if (!alvo) return null;
  const { error } = await db.from('items').update({ status }).eq('id', alvo.id);
  if (error) throw error;
  return alvo;
}

export async function reagendarItem(
  db: SupabaseClient, referencia: string, novoDueAt: string,
): Promise<Item | null> {
  const alvo = await acharTarefa(db, referencia);
  if (!alvo) return null;
  const { error } = await db.from('items')
    .update({ due_at: novoDueAt, lembrete_enviado: false }).eq('id', alvo.id);
  if (error) throw error;
  return { ...alvo, due_at: novoDueAt };
}

export async function eventosNaJanela(db: SupabaseClient, ateISO: string): Promise<CalendarEvent[]> {
  const { data, error } = await db.from('calendar_events').select('*')
    .eq('lembrete_enviado', false).lte('start_at', ateISO).gte('start_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

export async function tarefasNaJanela(db: SupabaseClient, ateISO: string): Promise<Item[]> {
  const { data, error } = await db.from('items').select('*')
    .eq('tipo', 'tarefa').eq('status', 'aberto').eq('lembrete_enviado', false)
    .not('due_at', 'is', null).lte('due_at', ateISO).gte('due_at', new Date().toISOString());
  if (error) throw error;
  return (data ?? []) as Item[];
}

export async function marcarLembreteEvento(db: SupabaseClient, gcalId: string): Promise<void> {
  const { error } = await db.from('calendar_events').update({ lembrete_enviado: true }).eq('gcal_id', gcalId);
  if (error) throw error;
}
export async function marcarLembreteTarefa(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('items').update({ lembrete_enviado: true }).eq('id', id);
  if (error) throw error;
}

// Registra o id da mensagem; retorna true se é nova, false se já foi processada (webhook duplicado).
export async function registrarMensagem(db: SupabaseClient, messageId: string): Promise<boolean> {
  const { error } = await db.from('processed_messages').insert({ message_id: messageId });
  if (error) {
    if ((error as { code?: string }).code === '23505') return false; // unique_violation
    throw error;
  }
  return true;
}

export async function upsertEvento(db: SupabaseClient, ev: { gcal_id: string; titulo: string; start_at: string }): Promise<void> {
  // Se o horário mudou, reseta lembrete_enviado para reavisar.
  const { data } = await db.from('calendar_events').select('start_at').eq('gcal_id', ev.gcal_id).maybeSingle();
  const horaMudou = data && data.start_at !== ev.start_at;
  const patch: Record<string, unknown> = { ...ev, updated_at: new Date().toISOString() };
  if (horaMudou) patch.lembrete_enviado = false;
  const { error } = await db.from('calendar_events').upsert(patch, { onConflict: 'gcal_id' });
  if (error) throw error;
}

export async function getRefreshToken(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('google_auth').select('refresh_token').eq('id', 1).maybeSingle();
  return data?.refresh_token ?? null;
}
export async function salvarRefreshToken(db: SupabaseClient, token: string): Promise<void> {
  const { error } = await db.from('google_auth')
    .upsert({ id: 1, refresh_token: token, updated_at: new Date().toISOString() });
  if (error) throw error;
}
