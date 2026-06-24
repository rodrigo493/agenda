// Transcrição de áudio via OpenAI Whisper. Recebe a URL de um arquivo de áudio
// (já decriptado pela Uazapi), baixa e envia ao endpoint de transcrição.
export async function transcreverAudio(fileURL: string): Promise<string> {
  const audio = await fetch(fileURL);
  if (!audio.ok) throw new Error(`baixar áudio ${audio.status}`);
  const blob = await audio.blob();

  const form = new FormData();
  form.append('file', blob, 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')!}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  return String(j.text ?? '').trim();
}
