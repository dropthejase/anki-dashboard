import { requireUser } from "./auth";
import { inviteToken, randomId, timingSafeEqual } from "./crypto";
import { HttpError, json, notFound, readBytes, readJson } from "./http";
import { rateLimit } from "./ratelimit";
import type { Ctx, Role, UserRow } from "./types";
import { addDays, boardName, HEX32, isRealDate, plausibleDate, utcDate } from "./validate";

const TOP_N = 100;
const MAX_BOARDS_PER_USER = 50;
/** Upper bound on a member limit. This is input validation, not a performance promise: a board view reads every member and their last seven days. */
export const MAX_MEMBERS_PER_BOARD = 15_000;

interface BoardRow {
  id: string;
  name: string;
  invite_enabled: number;
  invite_epoch: number;
  member_cap: number | null;
}

/**
 * Every board route starts here. A non-member gets exactly the same 404 as a board that does not exist,
 * so board existence is never revealed.
 */
async function requireMember(c: Ctx, boardId: string): Promise<{ user: UserRow; board: BoardRow; role: Role }> {
  const user = await requireUser(c);
  if (!HEX32.test(boardId)) throw notFound();
  const row = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.invite_enabled, b.invite_epoch, b.member_cap, m.role
     FROM boards b JOIN memberships m ON m.board_id = b.id AND m.user_id = ? WHERE b.id = ?`,
  )
    .bind(user.id, boardId)
    .first<BoardRow & { role: Role }>();
  if (!row) throw notFound();
  const { role, ...board } = row;
  return { user, board, role };
}

async function requireAdmin(c: Ctx, boardId: string) {
  const m = await requireMember(c, boardId);
  if (m.role !== "admin") throw new HttpError(403, "admin_required");
  return m;
}

const joinPath = async (c: Ctx, b: BoardRow) =>
  `/join#${b.id}.${await inviteToken(c.env.INVITE_HMAC_KEY, b.id, b.invite_epoch)}`;

export async function createBoard(c: Ctx): Promise<Response> {
  const user = await requireUser(c);
  const name = boardName((await readJson(c.req)).name);
  await rateLimit(c, "board-create-user", user.id, 20, 86_400);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?")
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_BOARDS_PER_USER) throw new HttpError(409, "too_many_boards");
  const id = randomId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, c.now),
    c.env.DB.prepare("INSERT INTO memberships (board_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").bind(
      id,
      user.id,
      c.now,
    ),
  ]);
  return json({ id, name }, 201);
}

export async function viewBoard(c: Ctx, boardId: string): Promise<Response> {
  const { user, board, role } = await requireMember(c, boardId);
  const requested = c.url.searchParams.get("date");
  if (requested !== null && !(isRealDate(requested) && plausibleDate(requested, c.now))) {
    throw new HttpError(400, "invalid_date");
  }
  const date = requested ?? utcDate(c.now);
  const members = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT ROW_NUMBER() OVER (ORDER BY today DESC, week DESC, display_name) AS rank, * FROM (
         SELECT u.id AS user_id, u.display_name, m.role, m.joined_at,
                COALESCE(SUM(CASE WHEN d.local_date = ?2 THEN d.review_count END), 0) AS today,
                COALESCE(SUM(d.review_count), 0) AS week,
                MAX(d.updated_at) AS last_updated
         FROM memberships m JOIN users u ON u.id = m.user_id
         LEFT JOIN daily_stats d ON d.user_id = u.id AND d.local_date BETWEEN ?3 AND ?2
         WHERE m.board_id = ?1 GROUP BY u.id))
     WHERE rank <= ?4 OR user_id = ?5 ORDER BY rank`,
  )
    .bind(board.id, date, addDays(date, -6), TOP_N, user.id)
    .all<{ rank: number; user_id: string; display_name: string; role: Role; joined_at: number; today: number; week: number; last_updated: number | null }>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE board_id = ?")
    .bind(board.id)
    .first<{ n: number }>();
  const showInvite = role === "admin" || board.invite_enabled === 1;
  const image = await c.env.DB.prepare("SELECT version FROM board_images WHERE board_id = ?").bind(board.id).first<{ version: number }>();
  return json({
    board: {
      id: board.id,
      name: board.name,
      image_version: image?.version ?? null,
      invite_enabled: board.invite_enabled === 1,
      member_cap: board.member_cap,
      max_members: MAX_MEMBERS_PER_BOARD,
      member_count: total?.n ?? 0,
    },
    role,
    date,
    join_path: showInvite && board.invite_enabled === 1 ? await joinPath(c, board) : null,
    members: members.results.map((m) => ({ ...m, is_me: m.user_id === user.id })),
  });
}

export async function updateBoard(c: Ctx, boardId: string): Promise<Response> {
  const { board } = await requireAdmin(c, boardId);
  const body = await readJson(c.req);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if ("name" in body) {
    sets.push("name = ?");
    vals.push(boardName(body.name));
  }
  if ("invite_enabled" in body) {
    if (typeof body.invite_enabled !== "boolean") throw new HttpError(400, "invalid_invite_enabled");
    sets.push("invite_enabled = ?");
    vals.push(body.invite_enabled ? 1 : 0);
  }
  if ("member_cap" in body) {
    const cap = body.member_cap;
    if (cap !== null && !(typeof cap === "number" && Number.isInteger(cap) && cap >= 1 && cap <= MAX_MEMBERS_PER_BOARD)) {
      throw new HttpError(400, "invalid_member_cap");
    }
    sets.push("member_cap = ?");
    vals.push(cap);
  }
  if (sets.length === 0) throw new HttpError(400, "nothing_to_update");
  await c.env.DB.prepare(`UPDATE boards SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, board.id).run();
  return json({ ok: true });
}

/** The picture is a small JPEG the browser has already cropped and shrunk. The server checks it really is one and
 *  how big it is, and always serves it as image/jpeg, so whatever else the bytes contain they are never run. */
const MAX_IMAGE_BYTES = 48 * 1024;
const MIN_IMAGE_BYTES = 100;

function looksLikeJpeg(b: Uint8Array): boolean {
  return b.length >= MIN_IMAGE_BYTES && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
}

export async function getImage(c: Ctx, boardId: string): Promise<Response> {
  const { board } = await requireMember(c, boardId);
  const row = await c.env.DB.prepare("SELECT image FROM board_images WHERE board_id = ?").bind(board.id).first<{ image: number[] }>();
  if (!row) throw notFound();
  // D1 returns a BLOB column as an array of byte values.
  return new Response(new Uint8Array(row.image), {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      // The address carries the picture's version, so a changed picture has a new address.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function setImage(c: Ctx, boardId: string): Promise<Response> {
  const { board } = await requireAdmin(c, boardId);
  if (c.req.headers.get("Content-Type")?.toLowerCase() !== "image/jpeg") throw new HttpError(415, "jpeg_required");
  const bytes = await readBytes(c.req, MAX_IMAGE_BYTES);
  if (!looksLikeJpeg(bytes)) throw new HttpError(400, "invalid_image");
  await c.env.DB.prepare(
    "INSERT INTO board_images (board_id, image, version) VALUES (?1, ?2, ?3) ON CONFLICT(board_id) DO UPDATE SET image = ?2, version = ?3",
  )
    .bind(board.id, bytes.buffer as ArrayBuffer, c.now)
    .run();
  return json({ image_version: c.now });
}

export async function removeImage(c: Ctx, boardId: string): Promise<Response> {
  const { board } = await requireAdmin(c, boardId);
  await c.env.DB.prepare("DELETE FROM board_images WHERE board_id = ?").bind(board.id).run();
  return json({ ok: true });
}

export async function regenerateInvite(c: Ctx, boardId: string): Promise<Response> {
  const { board } = await requireAdmin(c, boardId);
  const next = await c.env.DB.prepare("UPDATE boards SET invite_epoch = invite_epoch + 1 WHERE id = ? RETURNING *")
    .bind(board.id)
    .first<BoardRow>();
  return json({ join_path: next ? await joinPath(c, next) : null });
}

export async function setRole(c: Ctx, boardId: string, targetId: string): Promise<Response> {
  const { board } = await requireAdmin(c, boardId);
  const role = (await readJson(c.req)).role;
  if (role !== "admin" && role !== "member") throw new HttpError(400, "invalid_role");
  const exists = await c.env.DB.prepare("SELECT role FROM memberships WHERE board_id = ? AND user_id = ?")
    .bind(board.id, targetId)
    .first<{ role: Role }>();
  if (!exists) throw notFound();
  // One statement, so two concurrent demotions cannot leave the board without an admin.
  const res = await c.env.DB.prepare(
    `UPDATE memberships SET role = ?1 WHERE board_id = ?2 AND user_id = ?3
     AND (?1 = 'admin' OR role <> 'admin' OR (SELECT COUNT(*) FROM memberships WHERE board_id = ?2 AND role = 'admin') > 1)`,
  )
    .bind(role, board.id, targetId)
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "last_admin");
  return json({ ok: true });
}

export async function kick(c: Ctx, boardId: string, targetId: string): Promise<Response> {
  const { user, board } = await requireAdmin(c, boardId);
  if (targetId === user.id) throw new HttpError(400, "use_leave");
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM memberships WHERE board_id = ? AND user_id = ?")
    .bind(board.id, targetId)
    .first();
  if (!exists) throw notFound();
  // One statement, so two admins removing each other at once cannot leave the board without an admin.
  const res = await c.env.DB.prepare(
    `DELETE FROM memberships WHERE board_id = ?1 AND user_id = ?2
     AND NOT (role = 'admin' AND (SELECT COUNT(*) FROM memberships WHERE board_id = ?1 AND role = 'admin') = 1)`,
  )
    .bind(board.id, targetId)
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "last_admin");
  return json({ ok: true });
}

/** Deletes the board for everyone. Accounts and review stats are untouched. Needs the exact board name as confirmation. */
export async function deleteBoard(c: Ctx, boardId: string): Promise<Response> {
  const { board } = await requireAdmin(c, boardId);
  const confirm = (await readJson(c.req)).confirm;
  if (typeof confirm !== "string" || confirm !== board.name) throw new HttpError(400, "confirm_mismatch");
  // Memberships go with the board through the foreign key cascade.
  await c.env.DB.prepare("DELETE FROM boards WHERE id = ?").bind(board.id).run();
  return json({ ok: true });
}

export async function leave(c: Ctx, boardId: string): Promise<Response> {
  const { user, board } = await requireMember(c, boardId);
  const [res] = await c.env.DB.batch([
    // Blocks the sole admin from leaving a board that still has other members.
    c.env.DB.prepare(
      `DELETE FROM memberships WHERE board_id = ?1 AND user_id = ?2
       AND NOT (role = 'admin'
         AND (SELECT COUNT(*) FROM memberships WHERE board_id = ?1 AND role = 'admin') = 1
         AND (SELECT COUNT(*) FROM memberships WHERE board_id = ?1) > 1)`,
    ).bind(board.id, user.id),
    c.env.DB.prepare("DELETE FROM boards WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE board_id = boards.id)").bind(
      board.id,
    ),
  ]);
  if (res?.meta.changes === 0) throw new HttpError(409, "last_admin");
  return json({ ok: true });
}

/** Resolves a join attempt. Missing board, disabled link and wrong token are indistinguishable. */
async function resolveInvite(c: Ctx): Promise<{ user: UserRow; board: BoardRow }> {
  const user = await requireUser(c);
  await rateLimit(c, "join-user", user.id, 30, 3600);
  await rateLimit(c, "join-ip", c.ip, 120, 3600);
  const body = await readJson(c.req);
  const { board_id: id, token } = body;
  if (typeof id !== "string" || !HEX32.test(id) || typeof token !== "string" || token.length > 64) throw notFound();
  const board = await c.env.DB.prepare("SELECT id, name, invite_enabled, invite_epoch, member_cap FROM boards WHERE id = ?")
    .bind(id)
    .first<BoardRow>();
  const expected = await inviteToken(c.env.INVITE_HMAC_KEY, id, board?.invite_epoch ?? 0);
  const valid = timingSafeEqual(expected, token);
  if (!board || board.invite_enabled !== 1 || !valid) throw notFound();
  return { user, board };
}

export async function previewJoin(c: Ctx): Promise<Response> {
  const { user, board } = await resolveInvite(c);
  const n = await c.env.DB.prepare(
    "SELECT COUNT(*) AS members, SUM(user_id = ?) AS mine FROM memberships WHERE board_id = ?",
  )
    .bind(user.id, board.id)
    .first<{ members: number; mine: number | null }>();
  return json({ name: board.name, member_count: n?.members ?? 0, already_member: (n?.mine ?? 0) > 0 });
}

export async function join(c: Ctx): Promise<Response> {
  const { user, board } = await resolveInvite(c);
  const mine = await c.env.DB.prepare("SELECT COUNT(*) AS n, SUM(board_id = ?) AS here FROM memberships WHERE user_id = ?")
    .bind(board.id, user.id)
    .first<{ n: number; here: number | null }>();
  if ((mine?.here ?? 0) > 0) return json({ board_id: board.id, already_member: true });
  if ((mine?.n ?? 0) >= MAX_BOARDS_PER_USER) throw new HttpError(409, "too_many_boards");
  // The cap is checked inside the insert, so concurrent joins cannot exceed it.
  const res = await c.env.DB.prepare(
    `INSERT INTO memberships (board_id, user_id, role, joined_at)
     SELECT ?1, ?2, 'member', ?3
     WHERE (SELECT COUNT(*) FROM memberships WHERE board_id = ?1)
         < MIN(COALESCE((SELECT member_cap FROM boards WHERE id = ?1), ?4), ?4)`,
  )
    .bind(board.id, user.id, c.now, MAX_MEMBERS_PER_BOARD)
    .run();
  if (res.meta.changes === 0) throw new HttpError(409, "board_full");
  return json({ board_id: board.id, already_member: false }, 201);
}
