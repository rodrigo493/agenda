export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function isWithinWindow(startISO: string, nowISO: string, windowMin: number): boolean {
  const start = new Date(startISO).getTime();
  const now = new Date(nowISO).getTime();
  return start >= now && start <= now + windowMin * 60_000;
}

export function resolveReschedule(
  currentDueAt: string | null,
  absDueAt: string | null,
  deltaMin: number | null,
): string {
  if (absDueAt) return absDueAt;
  if (currentDueAt && deltaMin != null) return addMinutes(currentDueAt, deltaMin);
  throw new Error('reagendar sem data absoluta nem base para delta');
}

export function formatLocal(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}
