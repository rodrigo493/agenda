// Envia texto pelo WhatsApp via Uazapi. Endpoint /send/text, header "token".
export async function enviarWhatsApp(numero: string, texto: string): Promise<void> {
  const url = Deno.env.get('UAZAPI_URL')!;        // ex: https://<instancia>.uazapi.com
  const token = Deno.env.get('UAZAPI_TOKEN')!;
  const resp = await fetch(`${url}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!resp.ok) {
    throw new Error(`Uazapi ${resp.status}: ${await resp.text()}`);
  }
}

// Envia um áudio (URL pública) pelo WhatsApp via Uazapi (/send/media, type "audio").
export async function enviarAudio(numero: string, fileUrl: string): Promise<void> {
  const url = Deno.env.get('UAZAPI_URL')!;
  const token = Deno.env.get('UAZAPI_TOKEN')!;
  const resp = await fetch(`${url}/send/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ number: numero, type: 'audio', file: fileUrl }),
  });
  if (!resp.ok) throw new Error(`Uazapi media ${resp.status}: ${await resp.text()}`);
}

// Pede à Uazapi para decriptar/hospedar a mídia de uma mensagem e devolve a URL do arquivo.
export async function baixarMidiaURL(messageId: string): Promise<string> {
  const url = Deno.env.get('UAZAPI_URL')!;
  const token = Deno.env.get('UAZAPI_TOKEN')!;
  const resp = await fetch(`${url}/message/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ id: messageId }),
  });
  if (!resp.ok) throw new Error(`Uazapi download ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  const fileURL = j.fileURL ?? j.url ?? j.file;
  if (!fileURL) throw new Error('Uazapi download sem fileURL');
  return String(fileURL);
}
