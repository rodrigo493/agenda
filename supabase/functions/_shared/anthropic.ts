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
