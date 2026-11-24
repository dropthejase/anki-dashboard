export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...BASE_HEADERS, ...headers },
  });
}

export const notFound = () => new HttpError(404, "not_found");

const MAX_BODY_BYTES = 4096;

/** Reads the body but never more than the limit, so an oversized upload cannot be buffered into memory. */
export async function readBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("Content-Length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "body_too_large");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "body_too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return all;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "json_required");
  }
  const text = new TextDecoder().decode(await readBytes(req, MAX_BODY_BYTES));
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_json");
}
