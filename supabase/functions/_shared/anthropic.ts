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

// Lê e interpreta um print/imagem relacionado a IA (visão do Claude). Devolve conteúdo + link extraído.
export async function interpretarImagemIA(
  imageUrl: string, legenda: string,
): Promise<{ conteudo: string; link: string }> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
  const prompt = [
    'Este é um print/captura de tela relacionado a Inteligência Artificial',
    legenda ? `com o comentário do usuário: "${legenda}".` : '.',
    'Descreva e interprete o conteúdo: qual ferramenta/site/assunto de IA aparece e os pontos principais.',
    'Se houver uma URL/link visível na imagem, extraia-o.',
    'Responda APENAS em JSON: {"conteudo":"descrição completa e útil","link":"url visível ou \\"\\""}.',
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
    return { conteudo: String(o.conteudo ?? raw).trim(), link: typeof o.link === 'string' ? o.link : '' };
  } catch {
    return { conteudo: raw.trim(), link: '' };
  }
}
