import { getClient, getConfig, eventosNaJanela, tarefasNaJanela,
  marcarLembreteEvento, marcarLembreteTarefa } from '../_shared/db.ts';
import { selectReminders } from '../_shared/reminders.ts';
import { textoLembrete } from '../_shared/messages.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';
import { addMinutes } from '../_shared/datetime.ts';

Deno.serve(async () => {
  const db = getClient();
  try {
    const cfg = await getConfig(db);
    const nowISO = new Date().toISOString();
    const ateISO = addMinutes(nowISO, cfg.janela_minutos);

    const eventos = await eventosNaJanela(db, ateISO);
    const tarefas = await tarefasNaJanela(db, ateISO);
    const alvos = selectReminders(eventos, tarefas, nowISO, cfg.janela_minutos);

    for (const alvo of alvos) {
      try {
        await enviarWhatsApp(cfg.whatsapp_numero, textoLembrete(alvo, cfg.fuso));
        if (alvo.tipo === 'reuniao') await marcarLembreteEvento(db, alvo.id);
        else await marcarLembreteTarefa(db, alvo.id);
      } catch (e) {
        // falha de envio: NÃO marca enviado → tenta no próximo ciclo
        console.error('falha ao lembrar', alvo.id, e);
      }
    }
    return new Response(`lembretes: ${alvos.length}`, { status: 200 });
  } catch (e) {
    console.error('agenda-reminders erro:', e);
    return new Response('error', { status: 200 });
  }
});
