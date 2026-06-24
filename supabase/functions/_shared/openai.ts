// Transcrição de áudio via Groq Whisper (API compatível com OpenAI, plano gratuito).
// Recebe a URL de um áudio já decriptado pela Uazapi (entregue como .mp3), baixa e transcreve.
export async function transcreverAudio(fileURL: string): Promise<string> {
  const audio = await fetch(fileURL);
  if (!audio.ok) throw new Error(`baixar áudio ${audio.status}`);
  const blob = await audio.blob();

  const form = new FormData();
  form.append('file', blob, 'audio.mp3');   // Groq valida pela extensão; Uazapi entrega mp3
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'pt');

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')!}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Groq Whisper ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  return String(j.text ?? '').trim();
}
