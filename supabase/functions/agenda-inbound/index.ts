import { getClient, getConfig, inserirItem, buscarItens, marcarStatus, reagendarItem }
  from '../_shared/db.ts';
import { classificarMensagem } from '../_shared/anthropic.ts';
import { enviarWhatsApp } from '../_shared/uazapi.ts';
import { resolveReschedule } from '../_shared/datetime.ts';
import { textoConfirmacao, textoLista, textoReformular } from '../_shared/messages.ts';

// Extrai (numero, texto) do payload Uazapi. Ignora mensagens enviadas por nós (fromMe).
function extrair(payload: any): { numero: string; texto: string } | null {
  const m = payload?.message ?? payload?.data?.message ?? payload;
  const fromMe = m?.fromMe ?? m?.key?.fromMe ?? false;
  if (fromMe) return null;
  const texto = m?.text ?? m?.body ?? m?.message?.conversation ?? '';
  const numero = m?.sender ?? m?.chatid ?? m?.from ?? m?.key?.remoteJid ?? '';
  if (!texto || !numero) return null;
  return { numero: String(numero), texto: String(texto) };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const msg = extrair(payload);
    if (!msg) return new Response('ignored', { status: 200 });

    const db = getClient();
    const cfg = await getConfig(db);

    // Só responde ao número do dono (segurança: ninguém mais comanda a agenda).
    if (!msg.numero.includes(cfg.whatsapp_numero)) {
      return new Response('not owner', { status: 200 });
    }

    const nowISO = new Date().toISOString();
    const intent = await classificarMensagem(msg.texto, nowISO, cfg.fuso);
    let resposta: string;

    switch (intent.kind) {
      case 'ideia':
        await inserirItem(db, 'ideia', intent.texto, null);
        resposta = textoConfirmacao('ideia', intent.texto, null, cfg.fuso);
        break;
      case 'tarefa':
        await inserirItem(db, 'tarefa', intent.texto, intent.due_at);
        resposta = textoConfirmacao('tarefa', intent.texto, intent.due_at, cfg.fuso);
        break;
      case 'listar': {
        const items = await buscarItens(db, intent.escopo);
        resposta = textoLista(items, cfg.fuso);
        break;
      }
      case 'feito': {
        const alvo = await marcarStatus(db, intent.referencia, 'feito');
        resposta = alvo ? textoConfirmacao('feito', alvo.texto, null, cfg.fuso) : textoReformular();
        break;
      }
      case 'cancelar': {
        const alvo = await marcarStatus(db, intent.referencia, 'cancelado');
        resposta = alvo ? textoConfirmacao('cancelar', alvo.texto, null, cfg.fuso) : textoReformular();
        break;
      }
      case 'reagendar': {
        // precisa do due_at atual para snooze relativo
        const atual = (await buscarItens(db, 'abertos'))
          .find((i) => i.texto.toLowerCase().includes(intent.referencia.toLowerCase()));
        try {
          const novo = resolveReschedule(atual?.due_at ?? null, intent.due_at, intent.delta_min);
          const alvo = await reagendarItem(db, intent.referencia, novo);
          resposta = alvo ? textoConfirmacao('reagendar', alvo.texto, novo, cfg.fuso) : textoReformular();
        } catch {
          resposta = textoReformular();
        }
        break;
      }
      default:
        resposta = textoReformular();
    }

    await enviarWhatsApp(msg.numero, resposta);
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('agenda-inbound erro:', e);
    return new Response('error', { status: 200 }); // 200 evita retry storm da Uazapi
  }
});
