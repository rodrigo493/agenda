import { getClient } from './db.ts';

// Upload de imagem para o Storage público do Supabase (bucket "imagens") via supabase-js.
// Devolve a URL pública permanente (usada na fórmula =IMAGE() do Sheets).
export async function uploadImagem(bytes: Uint8Array, contentType: string): Promise<string> {
  const db = getClient();
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif' : 'jpg';
  const nome = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from('imagens').upload(nome, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  return db.storage.from('imagens').getPublicUrl(nome).data.publicUrl;
}
