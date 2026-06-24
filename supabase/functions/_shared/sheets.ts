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
