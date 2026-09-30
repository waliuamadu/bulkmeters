// Same-origin proxy. The upstream URL is deployment configuration, never user input.
import type { NextRequest } from 'next/server';
async function forward(req: NextRequest) {
  const upstream = process.env.API_ORIGIN;
  if (!upstream)
    return Response.json(
      {
        error:
          'API server is not configured. Follow the local setup guide to connect PostgreSQL and enable sign-in.',
      },
      { status: 503 },
    );
  const base = new URL(upstream);
  if (!['http:', 'https:'].includes(base.protocol))
    return Response.json(
      { error: 'Invalid API configuration' },
      { status: 503 },
    );
  const incoming = new URL(req.url);
  const target = new URL(incoming.pathname + incoming.search, base);
  const headers = new Headers();
  for (const name of ['content-type', 'cookie', 'x-csrf-token', 'origin']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method)
        ? undefined
        : await req.arrayBuffer(),
      redirect: 'manual',
    });
    const result = new Headers();
    for (const name of [
      'content-type',
      'content-disposition',
      'set-cookie',
      'location',
    ]) {
      const value = response.headers.get(name);
      if (value) result.set(name, value);
    }
    result.set('cache-control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      headers: result,
    });
  } catch {
    return Response.json(
      {
        error:
          'The API service is unavailable. Check that the backend and database are running.',
      },
      { status: 503 },
    );
  }
}
export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
