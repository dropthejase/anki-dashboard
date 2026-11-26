import { describe, expect, it } from "vitest";
import { call, db, joinBoard, makeBoard, makeUser, today, type TestUser } from "./helpers";

const GOOD = { days_studied: 12, retention_today: [40, 10], retention_week: [300, 60] };

async function setup() {
  const admin = await makeUser("Admin");
  const member = await makeUser("Member");
  const board = await makeBoard(admin);
  await joinBoard(member, board);
  return { admin, member, board };
}

/** Pushes the count and statistics, skipping the minimum gap between pushes. */
async function push(user: TestUser, stats: unknown, date = today(), count = 10) {
  await db().prepare("UPDATE users SET last_push_at = NULL WHERE id = ?").bind(user.id).run();
  return call("POST", "/api/sync", { secret: user.secret, body: { local_date: date, review_count: count, ...(stats === undefined ? {} : { stats }) } });
}

const rowFor = async (viewer: TestUser, boardId: string, name: string) =>
  (await call("GET", `/api/boards/${boardId}?date=${today()}`, { cookie: viewer.cookie })).data.members.find((m: any) => m.display_name === name);

describe("statistics sent with a push", () => {
  it("are stored and shown on the board, without exposing the raw columns", async () => {
    const { admin, member, board } = await setup();
    expect((await push(member, GOOD)).status).toBe(200);
    const row = await rowFor(admin, board.id, "Member");
    expect(row.stats).toEqual({
      days_studied: 12,
      retention_today: { passed: 40, failed: 10 },
      retention_week: { passed: 300, failed: 60 },
    });
    expect(Object.keys(row).filter((k) => k.startsWith("stats_"))).toEqual([]);
  });

  it("are null for a member who has sent none", async () => {
    const { admin, board } = await setup();
    expect((await rowFor(admin, board.id, "Member")).stats).toBeNull();
  });

  it("keep their last values when a later push sends none", async () => {
    const { admin, member, board } = await setup();
    await push(member, GOOD);
    await push(member, undefined, today(), 25);
    const row = await rowFor(admin, board.id, "Member");
    expect(row.today).toBe(25);
    expect(row.stats.days_studied).toBe(12);
  });

  it("ignore fields they do not use, such as the retrievability add-on 1.1.0 sent", async () => {
    const { admin, member, board } = await setup();
    expect((await push(member, { ...GOOD, retrievability: null })).status).toBe(200);
    const row = await rowFor(admin, board.id, "Member");
    expect(row.stats.days_studied).toBe(12);
    expect(row.stats).not.toHaveProperty("retrievability");
  });

  it("are ignored as a whole when invalid, and the review count is still accepted", async () => {
    const { admin, member, board } = await setup();
    const bad: unknown[] = [
      { ...GOOD, days_studied: 31 },
      { ...GOOD, days_studied: -1 },
      { ...GOOD, days_studied: 1.5 },
      { ...GOOD, retention_today: [1] },
      { ...GOOD, retention_today: [10_000, 1] },
      { ...GOOD, retention_week: [-1, 0] },
      { ...GOOD, retention_week: [70_001, 0] },
      { ...GOOD, retention_today: "40/10" },
      { retention_today: [1, 1], retention_week: [1, 1] },
      [],
      "stats",
      42,
    ];
    for (const stats of bad) {
      expect((await push(member, stats, today(), 7)).status, JSON.stringify(stats)).toBe(200);
      const row = await rowFor(admin, board.id, "Member");
      expect(row.today).toBe(7);
      expect(row.stats, JSON.stringify(stats)).toBeNull();
    }
  });

  it("hide today's retention unless it was sent today, and drop statistics older than the 7-day window", async () => {
    const { admin, member, board } = await setup();
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await push(member, GOOD, today());
    await db().prepare("UPDATE users SET stats_date = ? WHERE id = ?").bind(day(2), member.id).run();
    const stale = (await rowFor(admin, board.id, "Member")).stats;
    expect(stale.retention_today).toBeNull();
    expect(stale.retention_week).toEqual({ passed: 300, failed: 60 });
    await db().prepare("UPDATE users SET stats_date = ? WHERE id = ?").bind(day(8), member.id).run();
    expect((await rowFor(admin, board.id, "Member")).stats).toBeNull();
  });
});
