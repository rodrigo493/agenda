import type { CalendarEvent } from './types.ts';

export async function accessTokenFromRefresh(refresh: string): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`Google token ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).access_token as string;
}

// Lista eventos das próximas 24h COM horário marcado (ignora all-day: estes vêm com date, não dateTime).
export async function listarEventos(accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const max = new Date(now.getTime() + 24 * 3600_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(), timeMax: max.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
  });
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Google events ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  const out: CalendarEvent[] = [];
  for (const e of json.items ?? []) {
    if (!e.start?.dateTime) continue;   // pula all-day
    const startMs = new Date(e.start.dateTime).getTime();
    if (startMs < now.getTime()) continue;   // pula eventos passados (ex: recorrentes antigos)
    out.push({
      gcal_id: e.id, titulo: e.summary ?? '(sem título)',
      start_at: new Date(e.start.dateTime).toISOString(), lembrete_enviado: false,
    });
  }
  return out;
}

// Cria um evento no Google Agenda. opts.convidados = e-mails; opts.video = cria link do Meet.
export async function criarEvento(
  accessToken: string, titulo: string, startISO: string, fuso: string,
  opts: { convidados?: string[]; video?: boolean } = {}, durMin = 60,
): Promise<{ id: string; start_at: string; meetLink: string | null }> {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durMin * 60_000);
  const body: Record<string, unknown> = {
    summary: titulo,
    start: { dateTime: start.toISOString(), timeZone: fuso },
    end: { dateTime: end.toISOString(), timeZone: fuso },
  };
  if (opts.convidados?.length) body.attendees = opts.convidados.map((email) => ({ email }));
  if (opts.video) {
    body.conferenceData = {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  const params = new URLSearchParams();
  if (opts.video) params.set('conferenceDataVersion', '1');
  if (opts.convidados?.length) params.set('sendUpdates', 'all');
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) throw new Error(`Google create ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  const meetLink = json.hangoutLink
    ?? (json.conferenceData?.entryPoints ?? []).find((e: any) => e.entryPointType === 'video')?.uri
    ?? null;
  return { id: json.id as string, start_at: start.toISOString(), meetLink };
}

export interface EventoG { id: string; titulo: string; start_at: string }

// Lista eventos com horário marcado entre from e to (ISO).
export async function listarEventosRange(
  accessToken: string, fromISO: string, toISO: string,
): Promise<EventoG[]> {
  const params = new URLSearchParams({
    timeMin: fromISO, timeMax: toISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '50',
  });
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) throw new Error(`Google list ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  const out: EventoG[] = [];
  for (const e of json.items ?? []) {
    if (!e.start?.dateTime) continue;
    if (new Date(e.start.dateTime).getTime() < Date.now()) continue;   // ignora passados (ex: fantasma recorrente antigo)
    out.push({ id: e.id, titulo: e.summary ?? '(sem título)', start_at: new Date(e.start.dateTime).toISOString() });
  }
  return out;
}

// Acha o próximo evento (com hora) cujo título contém a referência (case-insensitive).
export async function buscarEvento(
  accessToken: string, referencia: string, fromISO: string, toISO: string,
): Promise<EventoG | null> {
  const evs = await listarEventosRange(accessToken, fromISO, toISO);
  const ref = referencia.toLowerCase();
  return evs.find((e) => e.titulo.toLowerCase().includes(ref)) ?? null;
}

export async function deletarEvento(accessToken: string, eventId: string): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok && resp.status !== 410) throw new Error(`Google delete ${resp.status}: ${await resp.text()}`);
}

export async function atualizarEvento(
  accessToken: string, eventId: string, newStartISO: string, fuso: string, durMin = 60,
): Promise<string> {
  const start = new Date(newStartISO);
  const end = new Date(start.getTime() + durMin * 60_000);
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { dateTime: start.toISOString(), timeZone: fuso },
        end: { dateTime: end.toISOString(), timeZone: fuso },
      }),
    },
  );
  if (!resp.ok) throw new Error(`Google update ${resp.status}: ${await resp.text()}`);
  return start.toISOString();
}
