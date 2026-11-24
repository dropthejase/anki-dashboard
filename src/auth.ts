import { sha256Hex } from "./crypto";
import { HttpError } from "./http";
import { rateLimit } from "./ratelimit";
import type { Ctx, DeviceUser, UserRow } from "./types";
import { DAY_MS } from "./validate";

const WRITES_PER_HOUR = 200;

export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/; // 256 bits, base64url

export const SESSION_COOKIE = "__Host-session";
export const SESSION_TTL_MS = 30 * DAY_MS;
export const SESSION_ABSOLUTE_MS = 90 * DAY_MS;
const SESSION_EXTEND_EVERY_MS = 3_600_000;

export function bearerSecret(c: Ctx): string | null {
  const h = c.req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  const secret = h.slice(7).trim();
  return SECRET_RE.test(secret) ? secret : null;
}

/** Authenticates the Anki add-on by this computer's key. Unknown or malformed keys get the same 401. */
export async function requireDevice(c: Ctx): Promise<DeviceUser> {
  const secret = bearerSecret(c);
  const row = secret
    ? await c.env.DB.prepare(
        `SELECT u.*, d.id AS device_id, d.last_seen_at AS d_seen
         FROM devices d JOIN users u ON u.id = d.user_id WHERE d.secret_hash = ?`,
      )
        .bind(await sha256Hex(secret))
        .first<DeviceUser & { d_seen: number | null }>()
    : null;
  if (!row) throw new HttpError(401, "unknown_identity");
  // Note when this computer was last seen, at most once a day, to avoid a write on every request.
  if (row.d_seen === null || c.now - row.d_seen > DAY_MS) {
    await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(c.now, row.device_id).run();
  }
  const { d_seen: _seen, ...user } = row;
  return user;
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** CSRF defence for cookie-authenticated state changes: the browser must send our own origin. */
export function requireSameOrigin(c: Ctx): void {
  if (c.req.headers.get("Origin") !== c.url.origin) throw new HttpError(403, "bad_origin");
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

/** Authenticates a browser session. State-changing methods must also pass the Origin check. */
export async function requireUser(c: Ctx): Promise<UserRow> {
  const raw = readCookie(c.req, SESSION_COOKIE);
  if (!raw) throw new HttpError(401, "not_signed_in");
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") requireSameOrigin(c);
  const idHash = await sha256Hex(raw);
  const row = await c.env.DB.prepare(
    `SELECT u.*, s.created_at AS s_created, s.expires_at AS s_expires
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ? AND s.created_at > ?`,
  )
    .bind(idHash, c.now, c.now - SESSION_ABSOLUTE_MS)
    .first<UserRow & { s_created: number; s_expires: number }>();
  if (!row) throw new HttpError(401, "not_signed_in");
  // Every change a signed-in user makes shares one hourly budget, so a single account cannot spam writes.
  if (method !== "GET" && method !== "HEAD") await rateLimit(c, "write-user", row.id, WRITES_PER_HOUR, 3600);
  // Extend the sliding expiry at most hourly to avoid a write on every request.
  if (c.now - (row.s_expires - SESSION_TTL_MS) > SESSION_EXTEND_EVERY_MS) {
    const next = Math.min(c.now + SESSION_TTL_MS, row.s_created + SESSION_ABSOLUTE_MS);
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?").bind(next, idHash).run();
  }
  const { s_created: _a, s_expires: _b, ...user } = row;
  return user;
}

