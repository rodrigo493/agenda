// Integração com Google Sheets para registrar ideias (colunas: Data | Ideia).
// Requer o escopo https://www.googleapis.com/auth/spreadsheets.
const ABA = 'ideias';

async function api(
  accessToken: string, method: string, path: string, body?: unknown,
): Promise<any> {
  const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw new Error(`Sheets ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// Garante que a aba "ideias" exista com cabeçalho. Idempotente.
export async function garantirAbaIdeias(accessToken: string, sheetId: string): Promise<void> {
  const meta = await api(accessToken, 'GET', `${sheetId}?fields=sheets.properties.title`);
  const existe = (meta.sheets ?? []).some((s: any) => s.properties?.title === ABA);
  if (existe) return;
  await api(accessToken, 'POST', `${sheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: ABA } } }],
  });
  await api(accessToken, 'PUT', `${sheetId}/values/${ABA}!A1:B1?valueInputOption=USER_ENTERED`, {
    values: [['Data', 'Ideia']],
  });
}

export async function appendIdeia(
  accessToken: string, sheetId: string, dataLocal: string, ideia: string,
): Promise<void> {
  await api(
    accessToken, 'POST',
    `${sheetId}/values/${ABA}!A:B:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: [[dataLocal, ideia]] },
  );
}

const ABA_IA = 'IA';

// Garante a aba "IA" com cabeçalho Data | Conteúdo | Link | Comentário. Idempotente.
export async function garantirAbaIA(accessToken: string, sheetId: string): Promise<void> {
  const meta = await api(accessToken, 'GET', `${sheetId}?fields=sheets.properties.title`);
  if ((meta.sheets ?? []).some((s: any) => s.properties?.title === ABA_IA)) return;
  await api(accessToken, 'POST', `${sheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: ABA_IA } } }],
  });
  await api(accessToken, 'PUT', `${sheetId}/values/${ABA_IA}!A1:D1?valueInputOption=USER_ENTERED`, {
    values: [['Data', 'Conteúdo', 'Link', 'Comentário']],
  });
}

export async function appendIA(
  accessToken: string, sheetId: string,
  data: string, conteudo: string, link: string, comentario: string,
): Promise<void> {
  await api(
    accessToken, 'POST',
    `${sheetId}/values/${ABA_IA}!A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: [[data, conteudo, link, comentario]] },
  );
}

const ABA_IMG = 'imagens';

// Garante a aba "imagens" (Data | Imagem | Comentário) com a coluna da imagem mais larga. Idempotente.
export async function garantirAbaImagens(accessToken: string, sheetId: string): Promise<void> {
  const meta = await api(accessToken, 'GET', `${sheetId}?fields=sheets.properties`);
  if ((meta.sheets ?? []).some((s: any) => s.properties?.title === ABA_IMG)) return;
  const res = await api(accessToken, 'POST', `${sheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: ABA_IMG } } }],
  });
  const gid = res.replies?.[0]?.addSheet?.properties?.sheetId;
  await api(accessToken, 'PUT', `${sheetId}/values/${ABA_IMG}!A1:C1?valueInputOption=USER_ENTERED`, {
    values: [['Data', 'Imagem', 'Comentário']],
  });
  if (gid != null) {
    await api(accessToken, 'POST', `${sheetId}:batchUpdate`, {
      requests: [{
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 200 }, fields: 'pixelSize',
        },
      }],
    });
  }
}

// Insere uma imagem (via =IMAGE) numa nova linha e deixa a linha alta o suficiente para vê-la.
export async function appendImagem(
  accessToken: string, sheetId: string, data: string, imageUrl: string, comentario: string,
): Promise<void> {
  const meta = await api(accessToken, 'GET', `${sheetId}?fields=sheets.properties`);
  const gid = (meta.sheets ?? []).find((s: any) => s.properties?.title === ABA_IMG)?.properties?.sheetId;
  const res = await api(
    accessToken, 'POST',
    `${sheetId}/values/${ABA_IMG}!A:C:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: [[data, `=IMAGE("${imageUrl}")`, comentario]] },
  );
  const m = String(res.updates?.updatedRange ?? '').match(/!A(\d+)/);
  if (gid != null && m) {
    const row = Number(m[1]) - 1;
    await api(accessToken, 'POST', `${sheetId}:batchUpdate`, {
      requests: [{
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: row, endIndex: row + 1 },
          properties: { pixelSize: 120 }, fields: 'pixelSize',
        },
      }],
    });
  }
}

// Lê as últimas ideias da aba (coluna B).
export async function lerIdeias(
  accessToken: string, sheetId: string, limite = 15,
): Promise<string[]> {
  try {
    const r = await api(accessToken, 'GET', `${sheetId}/values/${ABA}!A2:B`);
    const rows: any[] = r.values ?? [];
    return rows.slice(-limite).map((x) => x[1] ?? '').filter(Boolean);
  } catch {
    return [];
  }
}
