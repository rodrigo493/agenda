import { getClient, getConfig, inserirItem, buscarItens, marcarStatus, registrarMensagem,
  getRefreshToken, upsertEvento, removerEventoCache,
  salvarPendente, lerPendente, limparPendente } from '../_shared/db.ts';
import { classificarMensagem } from '../_shared/anthropic.ts';
import { enviarWhatsApp, baixarMidiaURL } from '../_shared/uazapi.ts';
import { transcreverAudio } from '../_shared/openai.ts';
import { resolveReschedule, formatLocal, addMinutes } from '../_shared/datetime.ts';
import { accessTokenFromRefresh, criarEvento, listarEventosRange, buscarEvento,
  deletarEvento, atualizarEvento } from '../_shared/gcal.ts';
import { garantirAbaIdeias, appendIdeia, lerIdeias } from '../_shared/sheets.ts';
import { textoConfirmacao, textoLista, textoReformular } from '../_shared/messages.ts';

// Fim do dia de hoje no fuso local (assume Brasil, UTC-3, sem horário de verão).
function fimDoDiaLocal(tz: string): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${ymd}T23:59:59-03:00`).toISOString();
}

// Cria o evento no Google, atualiza o cache e monta a mensagem de confirmação (Meet + convidados).
async function criarEventoCompleto(
  db: any, gToken: string, cfg: { fuso: string },
  titulo: string, due: string, convidados: string[], video: boolean,
): Promise<string> {
  const ev = await criarEvento(gToken, titulo, due, cfg.fuso, { convidados, video });
  await upsertEvento(db, { gcal_id: ev.id, titulo, start_at: ev.start_at });
  const extra = [
    ev.meetLink ? `\n🎥 Meet: ${ev.meetLink}` : '',
    convidados.length ? `\n👥 Convidados: ${convidados.join(', ')}` : '',
  ].join('');
  return `📅 Criado no seu Google Agenda: ${titulo} (${formatLocal(due, cfg.fuso)}). Te lembro ~10 min antes.${extra}`;
}

function segredoIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Extrai (numero, texto) do payload Uazapi. Ignora mensagens enviadas por nós (fromMe).
function extrair(payload: any): { numero: string; texto: string; id: string; audio: boolean } | null {
  const m = payload?.message ?? payload?.data?.message ?? payload;
  const fromMe = m?.fromMe ?? m?.key?.fromMe ?? false;
  if (fromMe) return null;
  // sender pode vir como "@lid" (id de privacidade); o telefone real está em sender_pn/chatid.
  const numeroRaw = m?.sender_pn ?? m?.chatid ?? m?.sender ?? m?.from ?? m?.key?.remoteJid ?? '';
  const numero = String(numeroRaw).split('@')[0].split(':')[0];
  if (!numero) return null;
  const mtype = String(m?.messageType ?? m?.type ?? '');
  const audio = mtype === 'AudioMessage' || m?.content?.PTT === true || m?.mediaType === 'audio';
  const texto = m?.text ?? m?.body ?? m?.message?.conversation ?? '';
  if (!texto && !audio) return null;   // sem texto e sem áudio → ignora
  const id = m?.id ?? m?.key?.id ?? m?.messageid ?? m?.message?.id ?? m?.messageId ?? '';
  return { numero: String(numero), texto: String(texto), id: String(id), audio };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const segredo = Deno.env.get('UAZAPI_WEBHOOK_SECRET') ?? '';
    const fornecido = req.headers.get('x-webhook-token') ?? url.searchParams.get('token') ?? '';
    if (!segredo || !segredoIgual(fornecido, segredo)) {
      return new Response('unauthorized', { status: 401 });
    }

    const payload = await req.json();
    const msg = extrair(payload);
    if (!msg) return new Response('ignored', { status: 200 });

    const db = getClient();
    const cfg = await getConfig(db);

    // Gate de dono: compara só dígitos; o número do remetente deve terminar com o do dono.
    const soDigitos = (s: string) => s.replace(/\D/g, '');
    const remetente = soDigitos(msg.numero);
    const dono = soDigitos(cfg.whatsapp_numero);
    if (!dono || !remetente.endsWith(dono)) {
      return new Response('not owner', { status: 200 });
    }

    if (msg.id) {
      const nova = await registrarMensagem(db, msg.id);
      if (!nova) return new Response('duplicate', { status: 200 });
    }

    // Áudio: baixa da Uazapi (já decriptado) e transcreve com Whisper.
    let textoMsg = msg.texto;
    if (msg.audio) {
      try {
        const fileURL = await baixarMidiaURL(msg.id);
        textoMsg = await transcreverAudio(fileURL);
      } catch (e) {
        console.error('transcrição de áudio falhou:', e);
        await enviarWhatsApp(msg.numero, '🎙️ Não consegui entender o áudio. Pode repetir ou escrever?');
        return new Response('audio fail', { status: 200 });
      }
      if (!textoMsg.trim()) {
        await enviarWhatsApp(msg.numero, '🎙️ Não captei nada no áudio. Pode repetir?');
        return new Response('audio empty', { status: 200 });
      }
    }

    const nowISO = new Date().toISOString();

    // Token do Google (uma vez) para as ações que mexem na agenda.
    const refresh = await getRefreshToken(db);
    const gToken = refresh ? await accessTokenFromRefresh(refresh).catch(() => null) : null;

    // Confirmação de evento pendente (fluxo de conflito): "sim" cria, "não" descarta.
    const pend = await lerPendente(db);
    if (pend) {
      const t = textoMsg.trim().toLowerCase();
      if (/^(sim|pode|confirma|confirmar|isso|ok|manda|cria|claro)\b/.test(t)) {
        await limparPendente(db);
        const r = gToken
          ? await criarEventoCompleto(db, gToken, cfg, pend.titulo, pend.due_at, pend.convidados, pend.video)
          : textoReformular();
        await enviarWhatsApp(msg.numero, r);
        return new Response('ok', { status: 200 });
      }
      if (/^(n[ãa]o|cancela|deixa|esquece|negativo)\b/.test(t)) {
        await limparPendente(db);
        await enviarWhatsApp(msg.numero, 'Ok, não criei. 👍');
        return new Response('ok', { status: 200 });
      }
      await limparPendente(db); // qualquer outra coisa: descarta o pendente e segue
    }

    const intent = await classificarMensagem(textoMsg, nowISO, cfg.fuso);
    let resposta: string;

    switch (intent.kind) {
      case 'ideia':
        if (gToken && cfg.sheet_ideias_id) {
          try {
            await garantirAbaIdeias(gToken, cfg.sheet_ideias_id);
            await appendIdeia(gToken, cfg.sheet_ideias_id, formatLocal(nowISO, cfg.fuso), intent.texto);
            resposta = `💡 Ideia anotada na planilha: ${intent.texto}`;
          } catch (e) {
            console.error('falha ao gravar ideia no Sheets:', e);
            await inserirItem(db, 'ideia', intent.texto, null);
            resposta = textoConfirmacao('ideia', intent.texto, null, cfg.fuso);
          }
        } else {
          await inserirItem(db, 'ideia', intent.texto, null);
          resposta = textoConfirmacao('ideia', intent.texto, null, cfg.fuso);
        }
        break;
      case 'tarefa':
        if (intent.due_at && gToken) {
          // Tem dia/hora → checa conflito; se houver, pergunta antes de criar.
          try {
            const due = intent.due_at;
            const conflitos = await listarEventosRange(gToken, due, addMinutes(due, 60));
            if (conflitos.length) {
              await salvarPendente(db, {
                titulo: intent.texto, due_at: due, convidados: intent.convidados, video: intent.video,
              });
              resposta = `⚠️ Você já tem "${conflitos[0].titulo}" às ${formatLocal(conflitos[0].start_at, cfg.fuso)}.\nQuer marcar "${intent.texto}" assim mesmo? Responde "sim" que eu crio.`;
            } else {
              resposta = await criarEventoCompleto(db, gToken, cfg, intent.texto, due, intent.convidados, intent.video);
            }
          } catch (e) {
            console.error('falha ao criar evento Google:', e);
            await inserirItem(db, 'tarefa', intent.texto, intent.due_at);
            resposta = `${textoConfirmacao('tarefa', intent.texto, intent.due_at, cfg.fuso)}\n(não consegui criar no Google agora; guardei aqui e te lembro mesmo assim)`;
          }
        } else if (intent.due_at) {
          await inserirItem(db, 'tarefa', intent.texto, intent.due_at);
          resposta = textoConfirmacao('tarefa', intent.texto, intent.due_at, cfg.fuso);
        } else {
          await inserirItem(db, 'tarefa', intent.texto, null);
          resposta = textoConfirmacao('tarefa', intent.texto, null, cfg.fuso);
        }
        break;
      case 'listar': {
        if (gToken) {
          const toISO = intent.escopo === 'hoje' ? fimDoDiaLocal(cfg.fuso) : addMinutes(nowISO, 7 * 24 * 60);
          const evs = await listarEventosRange(gToken, nowISO, toISO);
          const ideias = cfg.sheet_ideias_id ? await lerIdeias(gToken, cfg.sheet_ideias_id, 10) : [];
          const linhas: string[] = [];
          if (evs.length) {
            linhas.push(intent.escopo === 'hoje' ? '*Hoje na sua agenda:*' : '*Próximos compromissos:*');
            evs.forEach((e, n) => {
              linhas.push(`${n + 1}. ${e.titulo} · ${formatLocal(e.start_at, cfg.fuso)}`);
              if (e.meetLink) linhas.push(`   🔗 ${e.meetLink}`);
            });
          }
          if (ideias.length) {
            linhas.push('*Ideias:*');
            ideias.forEach((t) => linhas.push(`• ${t}`));
          }
          resposta = linhas.length ? linhas.join('\n') : 'Nada na sua agenda. 🎉';
        } else {
          resposta = textoLista(await buscarItens(db, intent.escopo), cfg.fuso);
        }
        break;
      }
      case 'feito': {
        const alvo = await marcarStatus(db, intent.referencia, 'feito');
        resposta = alvo ? textoConfirmacao('feito', alvo.texto, null, cfg.fuso) : textoReformular();
        break;
      }
      case 'cancelar': {
        const janelaFim = addMinutes(nowISO, 60 * 24 * 60); // próximos 60 dias
        const ev = gToken ? await buscarEvento(gToken, intent.referencia, nowISO, janelaFim) : null;
        if (ev && gToken) {
          await deletarEvento(gToken, ev.id);
          await removerEventoCache(db, ev.id);
          resposta = `🗑️ Cancelado na sua agenda: ${ev.titulo} (${formatLocal(ev.start_at, cfg.fuso)}).`;
        } else {
          const alvo = await marcarStatus(db, intent.referencia, 'cancelado');
          resposta = alvo ? textoConfirmacao('cancelar', alvo.texto, null, cfg.fuso) : textoReformular();
        }
        break;
      }
      case 'reagendar': {
        const janelaFim = addMinutes(nowISO, 60 * 24 * 60);
        const ev = gToken ? await buscarEvento(gToken, intent.referencia, nowISO, janelaFim) : null;
        if (ev && gToken) {
          try {
            const novo = resolveReschedule(ev.start_at, intent.due_at, intent.delta_min);
            const start = await atualizarEvento(gToken, ev.id, novo, cfg.fuso);
            await upsertEvento(db, { gcal_id: ev.id, titulo: ev.titulo, start_at: start });
            resposta = `🔁 Remarcado na sua agenda: ${ev.titulo} para ${formatLocal(start, cfg.fuso)}.`;
          } catch {
            resposta = textoReformular();
          }
        } else {
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
