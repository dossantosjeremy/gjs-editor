// Vercel Edge Function — streams Anthropic API responses to avoid timeout.
// Set ANTHROPIC_API_KEY in Vercel dashboard, OR pass it via x-api-key header.
export const config = { runtime: 'edge' };

export default async function handler(request: Request) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      request.headers.get('x-api-key') ||
      '';

    if (!apiKey) {
      return json({ error: 'No Anthropic API key. Set ANTHROPIC_API_KEY in Vercel or enter it in the Claude panel.' }, 400);
    }

    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

    // Force streaming — this keeps the connection alive and avoids Edge timeout
    body.stream = true;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      return json({ error: `Anthropic error ${upstream.status}: ${errText.slice(0, 300)}` }, upstream.status);
    }

    // Pipe the SSE stream straight through to the browser
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
