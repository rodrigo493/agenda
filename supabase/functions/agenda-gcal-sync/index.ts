import { getClient, getConfig, getRefreshToken, upsertEvento } from '../_shared/db.ts';
import { accessTokenFromRefresh, listarEventos } from '../_shared/gcal.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';

Deno.serve(async () => {
  const db = getClient();
  try {
    const refresh = await getRefreshToken(db);
    if (!refresh) return new Response('sem refresh token', { status: 200 });

    let accessToken: string;
    try {
      accessToken = await accessTokenFromRefresh(refresh);
    } catch (e) {
      // token revogado: avisa o dono uma vez (não spammar — só loga + 1 aviso por execução)
      const cfg = await getConfig(db);
      await enviarWhatsApp(cfg.whatsapp_numero,
        '⚠️ Perdi o acesso à sua Google Agenda. Reautorize quando puder.');
      console.error('refresh inválido:', e);
      return new Response('refresh inválido', { status: 200 });
    }

    const eventos = await listarEventos(accessToken);
    for (const ev of eventos) {
      try {
        await upsertEvento(db, { gcal_id: ev.gcal_id, titulo: ev.titulo, start_at: ev.start_at });
      } catch (e) {
        console.error('falha ao upsert evento', ev.gcal_id, e);
      }
    }
    return new Response(`sincronizados ${eventos.length}`, { status: 200 });
  } catch (e) {
    console.error('agenda-gcal-sync erro:', e);
    return new Response('error', { status: 200 });
  }
});
