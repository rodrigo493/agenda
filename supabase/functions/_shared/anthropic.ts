// Versão fixada em 23/06/2026 após cooldown (publicada 15/06/2026, 8 dias) e OSV limpo.
// Nunca usar @latest ou ^ — versão deve ser fixada (regra de segurança de dependências).
import Anthropic from 'npm:@anthropic-ai/sdk@0.104.2';
import type { Intent } from './types.ts';
import { buildClassifyPrompt, parseIntent } from './classify.ts';

export async function classificarMensagem(
  message: string, nowISO: string, tz: string,
): Promise<Intent> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
  const { system, user } = buildClassifyPrompt(message, nowISO, tz);
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const bloco = resp.content.find((b) => b.type === 'text');
  return parseIntent(bloco && 'text' in bloco ? bloco.text : '');
}

// Visão do Claude: decide se a imagem é de IA e, se for, interpreta. Senão, descreve brevemente.
export async function interpretarImagem(
  imageUrl: string, legenda: string,
): Promise<{ ehIA: boolean; conteudo: string; link: string }> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
  const prompt = [
    'Olhe esta imagem.',
    legenda ? `O usuário comentou: "${legenda}".` : '',
    'Ela é relacionada a Inteligência Artificial (print de ferramenta/site/artigo/post sobre IA, ou conteúdo de IA)?',
    'Se SIM: interprete (qual ferramenta/site/assunto de IA e os pontos principais) e extraia link visível.',
    'Se NÃO (foto comum, documento, pessoa, produto, etc): apenas descreva brevemente.',
    'Responda APENAS em JSON: {"ehIA":true|false,"conteudo":"interpretação se IA, senão breve descrição","link":"url visível ou \\"\\""}.',
  ].join(' ');
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const bloco = resp.content.find((b) => b.type === 'text');
  const raw = bloco && 'text' in bloco ? bloco.text : '';
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : raw);
    return { ehIA: o.ehIA === true, conteudo: String(o.conteudo ?? raw).trim(), link: typeof o.link === 'string' ? o.link : '' };
  } catch {
    return { ehIA: false, conteudo: raw.trim(), link: '' };
  }
}
