// Envio de e-mail pelo Gmail do dono (requer escopo gmail.send).
export async function enviarEmail(
  accessToken: string, para: string[], assunto: string, corpo: string,
): Promise<void> {
  // base64 UTF-8 seguro (lida com acentos)
  const b64utf8 = (s: string) => btoa(unescape(encodeURIComponent(s)));
  const headers = [
    `To: ${para.join(', ')}`,
    `Subject: =?UTF-8?B?${b64utf8(assunto)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ].join('\r\n');
  const raw = `${headers}\r\n\r\n${corpo}`;
  const encoded = b64utf8(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!resp.ok) throw new Error(`Gmail send ${resp.status}: ${await resp.text()}`);
}
