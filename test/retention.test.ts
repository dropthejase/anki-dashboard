import { describe, expect, it } from "vitest";
import { purge } from "../src/retention";
import { call, db, joinBoard, makeBoard, makeUser, pushStats } from "./helpers";

const DAY = 86_400_000;
const count = async (sql: string, ...b: unknown[]) => (await db().prepare(sql).bind(...b).first<{ n: number }>())?.n;

async function age(userId: string, days: number) {
  const iso = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  await db().prepare("UPDATE users SET created_at = ?, last_active_date = ? WHERE id = ?").bind(Date.now() - days * DAY, iso, userId).run();
}

describe("retention purge", () => {
  it("removes identities that never synced or joined after 30 days, and keeps the rest", async () => {
    const idle = await makeUser("Idle");
    const synced = await makeUser("Synced");
    const joined = await makeUser("Joined");
    const fresh = await makeUser("Fresh");
    await pushStats(synced, 3);
    await makeBoard(joined);
    for (const u of [idle, synced, joined]) await db().prepare("UPDATE users SET created_at = ? WHERE id = ?").bind(Date.now() - 31 * DAY, u.id).run();
    const result = await purge(db(), Date.now());
    expect(result.neverActivated).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?, ?)", synced.id, joined.id, fresh.id)).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id = ?", idle.id)).toBe(0);
  });

  it("removes users inactive for 12 months along with their data", async () => {
    const stale = await makeUser("Stale");
    await pushStats(stale, 9);
    await age(stale.id, 400);
    expect((await purge(db(), Date.now())).inactive).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM daily_stats")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
  });

  it("promotes the longest-standing active member when an inactive sole admin is purged", async () => {
    const admin = await makeUser("Admin");
    const early = await makeUser("Early");
    const late = await makeUser("Late");
    const board = await makeBoard(admin);
    await joinBoard(early, board);
    await joinBoard(late, board);
    await db().prepare("UPDATE memberships SET joined_at = 1 WHERE user_id = ?").bind(early.id).run();
    await db().prepare("UPDATE memberships SET joined_at = 2 WHERE user_id = ?").bind(late.id).run();
    await age(admin.id, 400);
    await purge(db(), Date.now());
    const roles = await db().prepare("SELECT user_id, role FROM memberships WHERE board_id = ?").bind(board.id).all<{ user_id: string; role: string }>();
    expect(Object.fromEntries(roles.results.map((r) => [r.user_id, r.role]))).toEqual({ [early.id]: "admin", [late.id]: "member" });
  });

  it("deletes a board left with no members", async () => {
    const admin = await makeUser();
    await makeBoard(admin);
    await age(admin.id, 400);
    await purge(db(), Date.now());
    expect(await count("SELECT COUNT(*) AS n FROM boards")).toBe(0);
  });

  it("clears expired sessions, login links and old rate-limit windows", async () => {
    const u = await makeUser();
    await call("POST", "/api/login-link", { secret: u.secret });
    await db().batch([
      db().prepare("UPDATE sessions SET expires_at = 1"),
      db().prepare("UPDATE login_links SET expires_at = 1"),
      db().prepare("UPDATE rate_limits SET window_start = 1"),
    ]);
    await purge(db(), Date.now());
    for (const t of ["sessions", "login_links", "rate_limits"]) expect(await count(`SELECT COUNT(*) AS n FROM ${t}`), t).toBe(0);
  });

  it("self-deletion promotes a successor the same way", async () => {
    const admin = await makeUser("Admin");
    const other = await makeUser("Other");
    const board = await makeBoard(admin);
    await joinBoard(other, board);
    await call("POST", "/api/me/delete", { cookie: admin.cookie, body: { confirm: "delete" } });
    const view = await call("GET", `/api/boards/${board.id}`, { cookie: other.cookie });
    expect(view.data.role).toBe("admin");
  });
});
