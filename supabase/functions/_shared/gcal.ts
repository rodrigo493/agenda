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
