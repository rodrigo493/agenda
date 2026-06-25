// Texto-para-voz via Google Cloud Text-to-Speech (chave de API). Devolve os bytes do MP3.
export async function sintetizarVoz(texto: string, languageCode: string): Promise<Uint8Array> {
  const key = Deno.env.get('GOOGLE_TTS_KEY')!;
  const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: texto },
      voice: { languageCode },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });
  if (!resp.ok) throw new Error(`TTS ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  const bin = atob(json.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
