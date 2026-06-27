import type { Intent } from './types.ts';

export function buildClassifyPrompt(
  message: string, nowISO: string, tz: string,
): { system: string; user: string } {
  const system = [
    'Você classifica mensagens de WhatsApp de uma agenda pessoal.',
    'Responda APENAS com um objeto JSON, sem texto em volta, com um campo "kind":',
    '- {"kind":"ideia","texto":string}  (texto = a ideia COMPLETA como foi dita; pode melhorar português e',
    '   clareza, mas NUNCA resuma nem corte detalhes — preserve TODO o conteúdo)',
    '- {"kind":"aparelhos","aparelho":string,"texto":string}  (ideia de melhoria de equipamento. aparelho =',
    '   modelo citado (ex: "V5","V12 Neuro","V8"), "" se não especificar; texto = a ideia COMPLETA, fiel, sem resumir)',
    '- {"kind":"tarefa","texto":string,"due_at":string|null,"convidados":string[],"video":boolean}',
    '   (due_at em ISO 8601 UTC com Z, null se sem hora; convidados = e-mails citados, [] se nenhum.',
    '    Converta e-mails DITADOS por voz: "arroba"→@, "ponto"→".", junte sem espaços. Ex: "fulano arroba',
    '    gmail ponto com" → "fulano@gmail.com". video = true se pedir vídeo/videochamada/Google Meet/link de reunião)',
    '- {"kind":"listar","escopo":"hoje"|"abertos"}',
    '- {"kind":"feito","referencia":string}      (referencia = trecho do texto da tarefa)',
    '- {"kind":"cancelar","referencia":string}',
    '- {"kind":"reagendar","referencia":string,"due_at":string|null,"delta_min":number|null}',
    '- {"kind":"traduzir","texto":string,"idioma":string,"formato":"audio"|"texto"}  (quando pedir para TRADUZIR.',
    '   texto = o que traduzir (NÃO traduza você, só extraia o texto original); idioma = código BCP-47 do destino',
    '   (en-US inglês [PADRÃO se não disserem], es-ES espanhol, pt-BR português, fr-FR francês, it-IT italiano);',
    '   formato = "texto" se pedir por escrito/em texto, senão "audio")',
    '- {"kind":"ia","conteudo":string,"link":string,"comentario":string}  (use quando a mensagem for sobre',
    '   INTELIGÊNCIA ARTIFICIAL: um link de ferramenta/artigo/site de IA, ou um assunto de IA. conteudo =',
    '   resumo/assunto; link = a URL se houver, senão ""; comentario = comentário extra do usuário, senão "")',
    '- {"kind":"email","para":string[],"assunto":string,"corpo":string}  (quando pedir para ENVIAR/MANDAR um',
    '   e-mail. Converta e-mails ditados: "arroba"→@, "ponto"→".", junte sem espaços e NUNCA omita partes do',
    '   domínio. Ex: "comercial arroba liveequipamentos ponto com ponto br" → "comercial@liveequipamentos.com.br".',
    '   Se citarem só um nome/setor interno SEM domínio claro (ex: "comercial", "financeiro", "Victor"), assuma',
    '   o domínio da empresa: @liveequipamentos.com.br. assunto = curto; corpo = texto BEM ESCRITO e cordial',
    '   a partir do que foi ditado, sem inventar fatos)',
    'Para TAREFA/evento, "texto" é só o assunto curto e limpo (ex: "Reunião com o Victor"), SEM palavras de',
    'comando ("marcar","criar evento","agendar","lembra de"), SEM data/hora, SEM e-mails e SEM "com vídeo".',
    'Ex: "marcar reunião com o Victor amanhã 15h com vídeo e convidar a@x.com"',
    '→ texto:"Reunião com o Victor", convidados:["a@x.com"], video:true.',
    'Para IDEIA é o OPOSTO: o "texto" deve ser a ideia COMPLETA e fiel ao que foi dito/falado, sem resumir nem',
    'encurtar; só corrija português e pontuação para ficar legível.',
    'Para datas/horas relativas ("hoje", "amanhã 15h", "sexta de manhã", "daqui 1h"), use SEMPRE a',
    'data/hora LOCAL do usuário (linha "agora (local)") como referência — NUNCA a data UTC, pois à noite',
    'o UTC já pode estar no dia seguinte. Ex: se "agora (local)" é 23/06 23h, então "hoje" = 23/06.',
    'Calcule o instante absoluto e devolva em UTC (ISO com Z). Para "snooze"/"adia X min/h" use delta_min.',
    'REGRA FORTE: se a mensagem começar com a palavra "ideia" (ditada ou escrita), classifique SEMPRE como',
    'kind "ideia", com texto = todo o conteúdo após "ideia" (completo, fiel, sem resumir).',
    'REGRA FORTE: se a mensagem começar com "aparelho" ou "aparelhos" (ex: "aparelho V5", "aparelho V12 Neuro"),',
    'classifique SEMPRE como kind "aparelhos"; aparelho = o modelo citado (V5, V12, etc; "" se não houver);',
    'texto = a ideia de melhoria (completa, fiel, sem resumir).',
    'REGRA FORTE: se a mensagem começar com "traduz"/"traduzir"/"tradução", classifique SEMPRE como kind',
    '"traduzir" (texto = o conteúdo a traduzir; idioma padrão en-US se não disserem; formato áudio salvo se pedir texto).',
    'REGRA FORTE: se a mensagem estiver em OUTRO idioma que não português (ex: inglês, espanhol) e NÃO for um',
    'comando, classifique como kind "traduzir" com idioma "pt-BR", formato "audio", texto = a mensagem original.',
    'REGRA FORTE: se a mensagem estiver em PORTUGUÊS e for apenas uma frase/texto comum (NÃO um comando de',
    'agenda/ideia/e-mail nem começar com "traduz"), trate como texto para TRADUZIR para inglês: kind "traduzir",',
    'idioma "en-US", formato "audio", texto = a mensagem. (Comandos sempre vêm antes desta regra.)',
    'Se não tiver certeza do que é, responda {"kind":"desconhecido"}.',
  ].join('\n');

  const local = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, dateStyle: 'full', timeStyle: 'short',
  }).format(new Date(nowISO));

  const user = [
    `agora (local, ${tz}): ${local}`,
    `agora (UTC): ${nowISO}`,
    `mensagem: ${message}`,
  ].join('\n');

  return { system, user };
}

export function parseIntent(raw: string): Intent {
  const unknown: Intent = { kind: 'desconhecido' };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return unknown;
    try { obj = JSON.parse(m[0]); } catch { return unknown; }
  }
  if (typeof obj !== 'object' || obj === null) return unknown;
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
  const dateOrNull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0);

  switch (o.kind) {
    case 'ideia':
      return str(o.texto) ? { kind: 'ideia', texto: o.texto } : unknown;
    case 'aparelhos':
      return str(o.texto)
        ? { kind: 'aparelhos', aparelho: typeof o.aparelho === 'string' ? o.aparelho : '', texto: o.texto }
        : unknown;
    case 'tarefa': {
      if (!str(o.texto) || !dateOrNull(o.due_at)) return unknown;
      const convidados = Array.isArray(o.convidados)
        ? o.convidados.filter((x): x is string => typeof x === 'string' && x.includes('@'))
        : [];
      return { kind: 'tarefa', texto: o.texto, due_at: o.due_at, convidados, video: o.video === true };
    }
    case 'listar':
      return o.escopo === 'hoje' || o.escopo === 'abertos'
        ? { kind: 'listar', escopo: o.escopo } : unknown;
    case 'feito':
      return str(o.referencia) ? { kind: 'feito', referencia: o.referencia } : unknown;
    case 'cancelar':
      return str(o.referencia) ? { kind: 'cancelar', referencia: o.referencia } : unknown;
    case 'reagendar':
      return str(o.referencia) && dateOrNull(o.due_at) && numOrNull(o.delta_min)
        ? { kind: 'reagendar', referencia: o.referencia, due_at: o.due_at, delta_min: o.delta_min } : unknown;
    case 'traduzir':
      return str(o.texto)
        ? {
          kind: 'traduzir',
          texto: o.texto,
          idioma: typeof o.idioma === 'string' && o.idioma ? o.idioma : 'en-US',
          formato: o.formato === 'texto' ? 'texto' : 'audio',
        }
        : unknown;
    case 'ia':
      return str(o.conteudo)
        ? {
          kind: 'ia',
          conteudo: o.conteudo,
          link: typeof o.link === 'string' ? o.link : '',
          comentario: typeof o.comentario === 'string' ? o.comentario : '',
        }
        : unknown;
    case 'email': {
      const para = Array.isArray(o.para)
        ? o.para.filter((x): x is string => typeof x === 'string' && /^[^\s<>"',;\r\n]+@[^\s<>"',;\r\n]+$/.test(x))
        : [];
      return para.length && str(o.corpo)
        ? { kind: 'email', para, assunto: typeof o.assunto === 'string' ? o.assunto : '(sem assunto)', corpo: o.corpo }
        : unknown;
    }
    default:
      return unknown;
  }
}
