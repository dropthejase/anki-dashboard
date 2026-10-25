import { DAY_MS, utcDate } from "./validate";

const NEVER_ACTIVATED_AFTER_MS = 30 * DAY_MS;
const INACTIVE_AFTER_MS = 365 * DAY_MS;
/** Bounds the work (and D1 calls) of one scheduled run. The job runs daily, so the backlog drains. */
const MAX_INACTIVE_PER_RUN = 25;

/**
 * Deletes a user and everything hanging off them. Cascades remove stats, memberships, sessions and links.
 * Where the user is the only admin of a board that still has other members, the longest-standing
 * (preferring active) member is promoted first. Boards left with no members are deleted.
 */
export async function deleteUser(db: D1Database, userId: string, now: number): Promise<void> {
  const activeCutoff = utcDate(now - INACTIVE_AFTER_MS);
  const boards = (
    await db
      .prepare(
        `SELECT m.board_id,
           m.role = 'admin' AND (SELECT COUNT(*) FROM memberships a WHERE a.board_id = m.board_id AND a.role = 'admin') = 1 AS sole_admin
         FROM memberships m WHERE m.user_id = ?`,
      )
      .bind(userId)
      .all<{ board_id: string; sole_admin: number }>()
  ).results;

  const stmts: D1PreparedStatement[] = [];
  for (const b of boards) {
    if (!b.sole_admin) continue;
    stmts.push(
      db
        .prepare(
          `UPDATE memberships SET role = 'admin'
           WHERE board_id = ?1 AND user_id = (
             SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.board_id = ?1 AND m.user_id <> ?2
             ORDER BY (u.last_active_date >= ?3) DESC, m.joined_at ASC LIMIT 1)`,
        )
        .bind(b.board_id, userId, activeCutoff),
    );
  }
  stmts.push(db.prepare("DELETE FROM users WHERE id = ?").bind(userId));
  for (const b of boards) {
    stmts.push(
      db
        .prepare("DELETE FROM boards WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE board_id = boards.id)")
        .bind(b.board_id),
    );
  }
  await db.batch(stmts);
}

export interface PurgeResult {
  neverActivated: number;
  inactive: number;
}

/** Daily retention job (see PRD section 10). */
export async function purge(db: D1Database, now: number): Promise<PurgeResult> {
  // RETURNING, because D1's meta.changes also counts rows removed by cascades.
  const never = await db
    .prepare(
      `DELETE FROM users WHERE created_at < ?
       AND NOT EXISTS (SELECT 1 FROM daily_stats WHERE user_id = users.id)
       AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = users.id)
       RETURNING id`,
    )
    .bind(now - NEVER_ACTIVATED_AFTER_MS)
    .all();

  const stale = (
    await db
      .prepare("SELECT id FROM users WHERE last_active_date < ? LIMIT ?")
      .bind(utcDate(now - INACTIVE_AFTER_MS), MAX_INACTIVE_PER_RUN)
      .all<{ id: string }>()
  ).results;
  for (const u of stale) await deleteUser(db, u.id, now);

  await db.batch([
    db.prepare("DELETE FROM login_links WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 2 * DAY_MS),
  ]);

  return { neverActivated: never.results.length, inactive: stale.length };
}
