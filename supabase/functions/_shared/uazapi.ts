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
