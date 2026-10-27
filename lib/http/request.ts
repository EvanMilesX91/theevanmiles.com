export class RequestBodyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readSmallJson(request: Request, limit = 16384): Promise<unknown> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) throw new RequestBodyError('Request is too large.', 413);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RequestBodyError('Use a JSON request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError('A JSON body is required.', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RequestBodyError('Request is too large.', 413); }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError('A valid JSON body is required.', 400);
  } finally { reader.releaseLock(); }
}
