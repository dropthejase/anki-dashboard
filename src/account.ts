import { bearerSecret, readCookie, requireDevice, requireSameOrigin, requireUser, SECRET_RE, SESSION_ABSOLUTE_MS, SESSION_COOKIE, sessionCookie, SESSION_TTL_MS } from "./auth";
import { newLinkCode, newRecoveryCode, randomId, randomToken, sha256Hex } from "./crypto";
import { HttpError, json, notFound, readJson } from "./http";
import { rateLimit } from "./ratelimit";
import { deleteUser } from "./retention";
import type { Ctx } from "./types";
import { deviceLabel, displayName, isRealDate, MAX_REVIEWS_PER_DAY, normaliseLinkCode, normaliseRecoveryCode, parseStats, plausibleDate, releaseVersion, utcDate } from "./validate";

const MIN_PUSH_INTERVAL_MS = 30 * 60_000;
const LINK_CODE_TTL_MS = 10 * 60_000;
export const MAX_DEVICES_PER_USER = 10;
const LOGIN_LINK_TTL_MS = 120_000;

/** Add-on: create the identity if its secret is new, otherwise return the existing one. Idempotent. */
export async function register(c: Ctx): Promise<Response> {
  const secret = bearerSecret(c);
  if (!secret) throw new HttpError(401, "unknown_identity");
  const body = await readJson(c.req);
  const hash = await sha256Hex(secret);
  const existing = await c.env.DB.prepare(
    "SELECT u.id, u.display_name FROM devices d JOIN users u ON u.id = d.user_id WHERE d.secret_hash = ?",
  )
    .bind(hash)
    .first<{ id: string; display_name: string }>();
  if (existing) return json({ user_id: existing.id, display_name: existing.display_name, created: false });

  const name = displayName(body.display_name);
  const label = deviceLabel(body.device_label);
  await rateLimit(c, "register-ip", c.ip, 10, 3600);
  const id = randomId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, display_name, created_at, last_active_date) VALUES (?, ?, ?, ?)").bind(
      id,
      name,
      c.now,
      utcDate(c.now),
    ),
    c.env.DB.prepare("INSERT INTO devices (id, user_id, secret_hash, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      randomId(),
      id,
      hash,
      label,
      c.now,
      c.now,
    ),
  ]);
  return json({ user_id: id, display_name: name, created: true }, 201);
}

/** Add-on: replace this computer's key with a new one and revoke the old one. Browser sessions and sign-in links are revoked too. */
export async function rotate(c: Ctx): Promise<Response> {
  const user = await requireDevice(c);
  const body = await readJson(c.req);
  const next = body.new_secret;
  if (typeof next !== "string" || !SECRET_RE.test(next)) throw new HttpError(400, "invalid_secret");
  await rateLimit(c, "rotate-user", user.id, 5, 86_400);
  const hash = await sha256Hex(next);
  if (await c.env.DB.prepare("SELECT 1 FROM devices WHERE secret_hash = ?").bind(hash).first()) {
    throw new HttpError(409, "secret_in_use");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE devices SET secret_hash = ? WHERE id = ?").bind(hash, user.device_id),
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
  const stats = parseStats(body.stats);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO daily_stats (user_id, local_date, review_count, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, local_date) DO UPDATE SET
         review_count = MAX(review_count, excluded.review_count), updated_at = excluded.updated_at`,
    ).bind(user.id, date, count, c.now),
    // The statistics ride on the same row write as the push time, so they add no rows written.
    stats
      ? c.env.DB.prepare(
          `UPDATE users SET last_push_at = ?, last_active_date = ?, stats_date = ?, stats_days = ?, stats_today_passed = ?,
             stats_today_failed = ?, stats_week_passed = ?, stats_week_failed = ?, stats_retrievability = ? WHERE id = ?`,
        ).bind(
          c.now,
          utcDate(c.now),
          date,
          stats.days_studied,
          stats.retention_today[0],
          stats.retention_today[1],
          stats.retention_week[0],
          stats.retention_week[1],
          stats.retrievability,
          user.id,
        )
      : c.env.DB.prepare("UPDATE users SET last_push_at = ?, last_active_date = ? WHERE id = ?").bind(c.now, utcDate(c.now), user.id),
  ]);
  const addonLatest = releaseVersion(c.env.ADDON_LATEST_VERSION);
  return json(addonLatest ? { ok: true, addon_latest: addonLatest } : { ok: true });
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
      c.now + SESSION_TTL_MS,
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
  const raw = readCookie(c.req, SESSION_COOKIE);
  if (raw) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ? AND user_id = ?").bind(await sha256Hex(raw), user.id).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

export async function me(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const boards = await c.env.DB.prepare(
    `SELECT b.id, b.name, m.role, (SELECT COUNT(*) FROM memberships x WHERE x.board_id = b.id) AS member_count,
            (SELECT version FROM board_images i WHERE i.board_id = b.id) AS image_version
     FROM memberships m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? ORDER BY b.name`,
  )
    .bind(user.id)
    .all();
  return json({
    user: { id: user.id, display_name: user.display_name },
    recovery: user.recovery_hash ? { created_at: user.recovery_created_at } : null,
    boards: boards.results,
  });
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



/** Website: make a new recovery code (replacing any earlier one). It is shown once and only its hash is kept. */
export async function createRecoveryCode(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  await rateLimit(c, "recovery-create-user", user.id, 5, 86_400);
  const code = newRecoveryCode();
  await c.env.DB.prepare("UPDATE users SET recovery_hash = ?, recovery_created_at = ? WHERE id = ?")
    .bind(await sha256Hex(code.normal), c.now, user.id)
    .run();
  return json({ code: code.shown, created_at: c.now }, 201);
}

/**
 * Add-on: use a recovery code to start over on this computer. No sign-in is needed, because the person has lost
 * their keys. In one atomic step the code is swapped for a fresh one (so it works once), every computer key, browser
 * session and linking code is cancelled, and this computer's new key becomes the account's only key. The fresh code is
 * returned so the account is never left without one. To add a computer without cancelling the others, use a link code.
 */
export async function recover(c: Ctx): Promise<Response> {
  await rateLimit(c, "recover-ip", c.ip, 10, 3600);
  const body = await readJson(c.req);
  const normal = normaliseRecoveryCode(body.recovery_code);
  const next = body.new_secret;
  if (typeof next !== "string" || !SECRET_RE.test(next)) throw new HttpError(400, "invalid_secret");
  // A wrong, malformed or already-used code all look the same.
  if (!normal) throw new HttpError(400, "invalid_recovery_code");
  const nextHash = await sha256Hex(next);
  if (await c.env.DB.prepare("SELECT 1 FROM devices WHERE secret_hash = ?").bind(nextHash).first()) {
    throw new HttpError(409, "secret_in_use");
  }
  const label = deviceLabel(body.device_label);
  const fresh = newRecoveryCode();
  const freshHash = await sha256Hex(fresh.normal);
  const owner = "(SELECT id FROM users WHERE recovery_hash = ?)";
  // Every later statement finds the account through the fresh hash, so if the first one matched nothing they do nothing.
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET recovery_hash = ?1, recovery_created_at = ?2 WHERE recovery_hash = ?3").bind(
      freshHash,
      c.now,
      await sha256Hex(normal),
    ),
    c.env.DB.prepare(`DELETE FROM devices WHERE user_id = ${owner}`).bind(freshHash),
    c.env.DB.prepare(
      "INSERT INTO devices (id, user_id, secret_hash, label, created_at, last_seen_at) SELECT ?1, id, ?2, ?3, ?4, ?4 FROM users WHERE recovery_hash = ?5",
    ).bind(randomId(), nextHash, label, c.now, freshHash),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ${owner}`).bind(freshHash),
    c.env.DB.prepare(`DELETE FROM login_links WHERE user_id = ${owner}`).bind(freshHash),
    c.env.DB.prepare(`DELETE FROM link_codes WHERE user_id = ${owner}`).bind(freshHash),
  ]);
  if (results[0]?.meta.changes !== 1) throw new HttpError(400, "invalid_recovery_code");
  const row = await c.env.DB.prepare("SELECT display_name FROM users WHERE recovery_hash = ?").bind(freshHash).first<{ display_name: string }>();
  return json({ ok: true, display_name: row?.display_name ?? "", recovery_code: fresh.shown, created_at: c.now });
}

/** Add-on: make a short code that adds another computer to this account. It works once and expires in 10 minutes. */
export async function createLinkCode(c: Ctx): Promise<Response> {
  const user = await requireDevice(c);
  await rateLimit(c, "link-code-user", user.id, 5, 3600);
  const code = newLinkCode();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM link_codes WHERE user_id = ?").bind(user.id),
    c.env.DB.prepare("INSERT INTO link_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
      await sha256Hex(code.normal),
      user.id,
      c.now + LINK_CODE_TTL_MS,
    ),
  ]);
  return json({ code: code.shown, expires_in_seconds: LINK_CODE_TTL_MS / 1000 }, 201);
}

/** Add-on on the new computer: trade a link code for a place on that account, using this computer's new key. */
export async function linkDevice(c: Ctx): Promise<Response> {
  await rateLimit(c, "link-ip", c.ip, 10, 3600);
  const body = await readJson(c.req);
  const normal = normaliseLinkCode(body.link_code);
  const next = body.new_secret;
  if (typeof next !== "string" || !SECRET_RE.test(next)) throw new HttpError(400, "invalid_secret");
  if (!normal) throw new HttpError(400, "invalid_link_code");
  const label = deviceLabel(body.device_label);
  const nextHash = await sha256Hex(next);
  if (await c.env.DB.prepare("SELECT 1 FROM devices WHERE secret_hash = ?").bind(nextHash).first()) {
    throw new HttpError(409, "secret_in_use");
  }
  // One statement uses the code up, so it works once even if two computers try at the same moment.
  const used = await c.env.DB.prepare(
    "UPDATE link_codes SET used_at = ?1 WHERE code_hash = ?2 AND used_at IS NULL AND expires_at > ?1 RETURNING user_id",
  )
    .bind(c.now, await sha256Hex(normal))
    .first<{ user_id: string }>();
  if (!used) throw new HttpError(400, "invalid_link_code");
  const added = await c.env.DB.prepare(
    `INSERT INTO devices (id, user_id, secret_hash, label, created_at, last_seen_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?5 WHERE (SELECT COUNT(*) FROM devices WHERE user_id = ?2) < ?6`,
  )
    .bind(randomId(), used.user_id, nextHash, label, c.now, MAX_DEVICES_PER_USER)
    .run();
  if (added.meta.changes === 0) throw new HttpError(409, "too_many_devices");
  const row = await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(used.user_id).first<{ display_name: string }>();
  return json({ ok: true, display_name: row?.display_name ?? "" }, 201);
}

/** Website: the computers on this account. */
export async function listDevices(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const rows = await c.env.DB.prepare("SELECT id, label, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at")
    .bind(user.id)
    .all();
  return json({ devices: rows.results });
}

/** Website: remove a computer. The last one cannot be removed, so an account always has a way in. */
export async function removeDevice(c: Ctx, deviceId: string): Promise<Response> {
  const user = await requireUser(c);
  const removed = await c.env.DB.prepare(
    "DELETE FROM devices WHERE id = ?1 AND user_id = ?2 AND (SELECT COUNT(*) FROM devices WHERE user_id = ?2) > 1",
  )
    .bind(deviceId, user.id)
    .run();
  if (removed.meta.changes === 0) {
    const exists = await c.env.DB.prepare("SELECT 1 FROM devices WHERE id = ? AND user_id = ?").bind(deviceId, user.id).first();
    throw exists ? new HttpError(409, "last_device") : notFound();
  }
  return json({ ok: true });
}
