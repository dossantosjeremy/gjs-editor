// Vercel Edge Function — proxies requests to the Anthropic API.
// Set ANTHROPIC_API_KEY in Vercel dashboard, OR pass it via x-api-key header
// (stored in the editor's browser localStorage — never in the bundle).
export const config = { runtime: 'edge' };

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    request.headers.get('x-api-key') ||
    '';

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'No Anthropic API key configured. Set ANTHROPIC_API_KEY in Vercel or enter it in the Claude panel.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
