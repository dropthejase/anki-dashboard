import { bearerSecret, requireDevice, requireSameOrigin, requireUser, SECRET_RE, SESSION_ABSOLUTE_MS, SESSION_COOKIE, sessionCookie, SESSION_TTL } from "./auth";
import { randomId, randomToken, sha256Hex } from "./crypto";
import { HttpError, json, notFound, readJson } from "./http";
import { rateLimit } from "./ratelimit";
import { deleteUser } from "./retention";
import type { Ctx } from "./types";
import { displayName, isRealDate, MAX_REVIEWS_PER_DAY, plausibleDate, utcDate } from "./validate";

const MIN_PUSH_INTERVAL_MS = 5 * 60_000;
const LOGIN_LINK_TTL_MS = 120_000;

/** Add-on: create the identity if its secret is new, otherwise return the existing one. Idempotent. */
export async function register(c: Ctx): Promise<Response> {
  const secret = bearerSecret(c);
  if (!secret) throw new HttpError(401, "unknown_identity");
  const body = await readJson(c.req);
  const hash = await sha256Hex(secret);
  const existing = await c.env.DB.prepare("SELECT id, display_name FROM users WHERE secret_hash = ?")
    .bind(hash)
    .first<{ id: string; display_name: string }>();
  if (existing) return json({ user_id: existing.id, display_name: existing.display_name, created: false });

  const name = displayName(body.display_name);
  await rateLimit(c, "register-ip", c.ip, 10, 3600);
  const id = randomId();
  await c.env.DB.prepare(
    "INSERT INTO users (id, secret_hash, display_name, created_at, last_active_date) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, hash, name, c.now, utcDate(c.now))
    .run();
  return json({ user_id: id, display_name: name, created: true }, 201);
}

/** Add-on: replace the identity secret with a new one and revoke the old one, sessions included. */
export async function rotate(c: Ctx): Promise<Response> {
  const user = await requireDevice(c);
  const body = await readJson(c.req);
  const next = body.new_secret;
  if (typeof next !== "string" || !SECRET_RE.test(next)) throw new HttpError(400, "invalid_secret");
  await rateLimit(c, "rotate-user", user.id, 5, 86_400);
  const hash = await sha256Hex(next);
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE secret_hash = ?").bind(hash).first()) {
    throw new HttpError(409, "secret_in_use");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET secret_hash = ? WHERE id = ?").bind(hash, user.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("DELETE FROM login_links WHERE user_id = ?").bind(user.id),
  ]);
  return json({ ok: true });
}

/** Add-on: push today's review count. */
export async function sync(c: Ctx): Promise<Response> {
  const user = await requireDevice(c);
  const body = await readJson(c.req);
  const { local_date: date, review_count: count } = body;
  if (!isRealDate(date) || !plausibleDate(date, c.now)) throw new HttpError(400, "invalid_date");
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw new HttpError(400, "invalid_count");
  if (count > MAX_REVIEWS_PER_DAY) throw new HttpError(400, "over_cap");
  if (user.last_push_at !== null && c.now - user.last_push_at < MIN_PUSH_INTERVAL_MS) {
    const wait = Math.ceil((MIN_PUSH_INTERVAL_MS - (c.now - user.last_push_at)) / 1000);
    throw new HttpError(429, "too_soon", { retry_after_seconds: wait });
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO daily_stats (user_id, local_date, review_count, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, local_date) DO UPDATE SET
         review_count = MAX(review_count, excluded.review_count), updated_at = excluded.updated_at`,
    ).bind(user.id, date, count, c.now),
    c.env.DB.prepare("UPDATE users SET last_push_at = ?, last_active_date = ? WHERE id = ?").bind(
      c.now,
      utcDate(c.now),
      user.id,
    ),
  ]);
  return json({ ok: true });
}

/** Add-on: request a one-time sign-in token (the add-on puts it in a URL fragment). */
export async function createLoginLink(c: Ctx): Promise<Response> {
  const user = await requireDevice(c);
  await rateLimit(c, "login-link-user", user.id, 10, 3600);
  const token = randomToken(16);
  await c.env.DB.prepare("INSERT INTO login_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), user.id, c.now + LOGIN_LINK_TTL_MS)
    .run();
  return json({ token, expires_in_seconds: LOGIN_LINK_TTL_MS / 1000 }, 201);
}

async function tokenFromBody(c: Ctx): Promise<string> {
  requireSameOrigin(c);
  await rateLimit(c, "login-link-ip", c.ip, 60, 3600);
  const { token } = await readJson(c.req);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(token)) throw new HttpError(400, "invalid_link");
  return sha256Hex(token);
}

/** Browser: names the account behind a link without consuming it, for the "Sign in as ...?" interstitial. */
export async function inspectLoginLink(c: Ctx): Promise<Response> {
  const hash = await tokenFromBody(c);
  const row = await c.env.DB.prepare(
    `SELECT u.display_name FROM login_links l JOIN users u ON u.id = l.user_id
     WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?`,
  )
    .bind(hash, c.now)
    .first<{ display_name: string }>();
  if (!row) throw new HttpError(400, "invalid_link");
  return json({ display_name: row.display_name });
}

/** Browser: consume the link exactly once and start a session. */
export async function consumeLoginLink(c: Ctx): Promise<Response> {
  const hash = await tokenFromBody(c);
  const link = await c.env.DB.prepare(
    `UPDATE login_links SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1 RETURNING user_id`,
  )
    .bind(c.now, hash)
    .first<{ user_id: string }>();
  if (!link) throw new HttpError(400, "invalid_link");
  const sid = randomToken(32);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sha256Hex(sid),
      link.user_id,
      c.now,
      c.now + SESSION_TTL,
    ),
    c.env.DB.prepare("UPDATE users SET last_active_date = ? WHERE id = ? AND last_active_date <> ?").bind(
      utcDate(c.now),
      link.user_id,
      utcDate(c.now),
    ),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(sid, SESSION_ABSOLUTE_MS / 1000) });
}

export async function logout(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const raw = (c.req.headers.get("Cookie") ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (raw) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ? AND user_id = ?").bind(await sha256Hex(raw), user.id).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

export async function me(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const boards = await c.env.DB.prepare(
    `SELECT b.id, b.name, m.role, (SELECT COUNT(*) FROM memberships x WHERE x.board_id = b.id) AS member_count
     FROM memberships m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? ORDER BY b.name`,
  )
    .bind(user.id)
    .all();
  return json({ user: { id: user.id, display_name: user.display_name }, boards: boards.results });
}

export async function updateMe(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const body = await readJson(c.req);
  const name = displayName(body.display_name);
  await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, user.id).run();
  return json({ display_name: name });
}

export async function deleteMe(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const body = await readJson(c.req);
  if (body.confirm !== "delete") throw new HttpError(400, "confirmation_required");
  await deleteUser(c.env.DB, user.id, c.now);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

export const unknownRoute = () => notFound();
