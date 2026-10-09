export class WaypointBackendError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export function waypointBackendUrl(path: string): URL {
  const raw = process.env.WAYPOINT_BACKEND_URL;
  const token = process.env.WAYPOINT_SERVICE_TOKEN;
  if (!raw || !token || token.length < 32) throw new WaypointBackendError('Waypoint’s engine is not connected yet. Complete the server configuration.');
  let base: URL;
  try { base = new URL(raw); } catch { throw new WaypointBackendError('Waypoint’s engine address is not configured correctly.'); }
  const local = ['localhost', '127.0.0.1'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && base.protocol === 'http:')) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new WaypointBackendError('Waypoint’s engine address is not configured correctly.');
  }
  return new URL(`/api/${path}`, base);
}

export async function callWaypointBackend(path: string, init: RequestInit = {}): Promise<Response> {
  const url = waypointBackendUrl(path);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.WAYPOINT_SERVICE_TOKEN}`,
        ...(process.env.WAYPOINT_BACKEND_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.WAYPOINT_BACKEND_BYPASS_SECRET } : {}),
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(path === 'refresh' ? 55000 : 15000),
    });
  } catch { throw new WaypointBackendError('Waypoint’s engine did not respond. The outcome could not be confirmed; check your journal before recording the same fill again.'); }
}

export async function readSmallJson(request: Request, limit = 16384): Promise<unknown> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) throw new WaypointBackendError('Request is too large.', 413);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new WaypointBackendError('Use a JSON request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new WaypointBackendError('A JSON body is required.', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new WaypointBackendError('Request is too large.', 413); }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof WaypointBackendError) throw error;
    throw new WaypointBackendError('A valid JSON body is required.', 400);
  } finally { reader.releaseLock(); }
}
