import { NextRequest, NextResponse } from 'next/server';
import { isWaypointAuthenticated, WAYPOINT_COOKIE } from '@/lib/waypoint/auth';
import { callWaypointBackend } from '@/lib/waypoint/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
  'X-Accel-Buffering': 'no',
};

function unavailable(code: string, detail: string, retryable: boolean) {
  // EventSource does not expose HTTP error bodies. Deliver only a safe status event.
  return new Response(`event: unavailable\ndata: ${JSON.stringify({ code, detail, retryable })}\n\n`, { headers });
}

export async function GET(request: NextRequest) {
  if (!isWaypointAuthenticated(request.cookies.get(WAYPOINT_COOKIE)?.value)) {
    return NextResponse.json({ detail: 'Please sign in to Waypoint.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const abort = new AbortController();
  const stop = () => abort.abort();
  request.signal.addEventListener('abort', stop, { once: true });
  // Each reconnect revalidates the owner's session. Nothing buffers the upstream SSE body.
  const timeout = setTimeout(stop, 55000);
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', stop);
    stop();
  };
  try {
    if (request.signal.aborted) stop();
    const upstream = await callWaypointBackend('events', { signal: abort.signal });
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
      await upstream.body?.cancel();
      cleanup();
      return upstream.status === 409
        ? unavailable('streaming_worker_required', 'Live streaming needs the Windows background engine. This hosted engine can show saved data, but cannot maintain an Alpaca connection.', false)
        : unavailable('stream_unavailable', 'Live updates are temporarily unavailable. Prices and signals are paused while the connection recovers.', true);
    }
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { cleanup(); controller.close(); }
          else controller.enqueue(chunk.value);
        } catch {
          cleanup();
          controller.close();
        }
      },
      async cancel(reason) {
        cleanup();
        await reader.cancel(reason).catch(() => undefined);
      },
    });
    return new Response(body, { headers });
  } catch {
    cleanup();
    return unavailable('stream_unavailable', 'Live updates are temporarily unavailable. Prices and signals are paused while the connection recovers.', true);
  }
}
