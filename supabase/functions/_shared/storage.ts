// Upload de imagem para o Storage público do Supabase (bucket "imagens").
// Devolve a URL pública permanente (usada na fórmula =IMAGE() do Sheets).
export async function uploadImagem(bytes: Uint8Array, contentType: string): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif' : 'jpg';
  const nome = `${crypto.randomUUID()}.${ext}`;
  const resp = await fetch(`${base}/storage/v1/object/imagens/${nome}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!resp.ok) throw new Error(`Storage upload ${resp.status}: ${await resp.text()}`);
  return `${base}/storage/v1/object/public/imagens/${nome}`;
}
