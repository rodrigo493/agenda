import { getClient, getConfig, getRefreshToken, buscarItens } from '../_shared/db.ts';
import { accessTokenFromRefresh, listarEventosRange } from '../_shared/gcal.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';

// Fim do dia de hoje no fuso local (assume Brasil, UTC-3, sem horário de verão).
function fimDoDiaLocal(tz: string): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${ymd}T23:59:59-03:00`).toISOString();
}

Deno.serve(async () => {
  const db = getClient();
  try {
    const cfg = await getConfig(db);
    const nowISO = new Date().toISOString();
    const horaLocal = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
      timeZone: cfg.fuso, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
    const hojeStr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: cfg.fuso, weekday: 'long', day: '2-digit', month: '2-digit',
    }).format(new Date());

    const refresh = await getRefreshToken(db);
    const evs = refresh
      ? await listarEventosRange(await accessTokenFromRefresh(refresh), nowISO, fimDoDiaLocal(cfg.fuso))
      : [];
    const tarefas = (await buscarItens(db, 'hoje')).filter((i) => i.tipo === 'tarefa');

    const partes: string[] = [`☀️ *Bom dia!* Sua agenda de hoje\n_${hojeStr}_`];
    if (evs.length) {
      const itens = evs.map((e) => {
        const base = `🕐 *${horaLocal(e.start_at)}*  ${e.titulo}`;
        return e.meetLink ? `${base}\n🔗 ${e.meetLink}` : base;
      }).join('\n\n');
      partes.push(`📅 *REUNIÕES* (${evs.length})\n\n${itens}`);
    }
    if (tarefas.length) {
      const itens = tarefas
        .map((t) => `🕐 *${t.due_at ? horaLocal(t.due_at) : '—'}*  ${t.texto}`)
        .join('\n\n');
      partes.push(`✅ *TAREFAS* (${tarefas.length})\n\n${itens}`);
    }
    if (!evs.length && !tarefas.length) partes.push('Nada marcado — dia livre! 🎉');

    await enviarWhatsApp(cfg.whatsapp_numero, partes.join('\n\n━━━━━━━━━━\n\n'));
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('agenda-resumo-diario erro:', e);
    return new Response('error', { status: 200 });
  }
});
