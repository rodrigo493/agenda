import { getClient, salvarRefreshToken } from '../_shared/db.ts';

// Fluxo: o dono abre /agenda-oauth-callback?start=1 → redireciona pro consentimento Google.
// Google volta com ?code=... → trocamos por refresh_token e gravamos.
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const redirectUri = `${url.origin}${url.pathname}`;
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

  if (url.searchParams.get('start') === '1') {
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', redirectUri);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('access_type', 'offline');
    auth.searchParams.set('prompt', 'consent');
    auth.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
    return Response.redirect(auth.toString(), 302);
  }

  const code = url.searchParams.get('code');
  if (!code) return new Response('faltou code', { status: 400 });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) return new Response(`erro Google: ${await resp.text()}`, { status: 400 });
  const json = await resp.json();
  if (!json.refresh_token) {
    return new Response('Google não retornou refresh_token (revogue o acesso e tente de novo).', { status: 400 });
  }
  await salvarRefreshToken(getClient(), json.refresh_token);
  return new Response('✅ Google Agenda conectada! Pode fechar esta aba.', { status: 200 });
});
