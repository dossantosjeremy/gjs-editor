// Vercel Edge Function — proxies requests to the Anthropic API.
// Set ANTHROPIC_API_KEY in Vercel dashboard, OR pass it via x-api-key header
// (stored in the editor's browser localStorage — never in the bundle).
export const config = { runtime: 'edge' };

export default async function handler(request: Request) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      request.headers.get('x-api-key') ||
      '';

    if (!apiKey) {
      return json(
        { error: 'No Anthropic API key configured. Set ANTHROPIC_API_KEY in Vercel or enter it in the Claude panel.' },
        400,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
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

    // Parse as text first so a non-JSON upstream response doesn't crash
    const text = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: `Upstream error: ${text.slice(0, 300)}` }, 502);
    }

    return json(data, upstream.status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
