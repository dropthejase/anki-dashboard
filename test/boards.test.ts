import { describe, expect, it } from "vitest";
import { call, db, joinBoard, makeBoard, makeUser, ORIGIN, pushStats, today, type TestUser } from "./helpers";

const MISSING = "0123456789abcdef0123456789abcdef";

async function setup() {
  const admin = await makeUser("Admin");
  const member = await makeUser("Member");
  const outsider = await makeUser("Outsider");
  const board = await makeBoard(admin);
  await joinBoard(member, board);
  return { admin, member, outsider, board };
}

describe("authorisation matrix", () => {
  // [method, path builder, body]. `t` is the target member's id.
  const routes = (b: string, t: string): [string, string, unknown?][] => [
    ["GET", `/api/boards/${b}`],
    ["PATCH", `/api/boards/${b}`, { name: "Renamed" }],
    ["POST", `/api/boards/${b}/invite/regenerate`],
    ["POST", `/api/boards/${b}/members/${t}/role`, { role: "admin" }],
    ["DELETE", `/api/boards/${b}/members/${t}`],
    ["POST", `/api/boards/${b}/leave`],
    ["POST", `/api/boards/${b}/delete`, { confirm: "Study group" }],
  ];

  it("hides every board route from non-members, identically to a missing board", async () => {
    const { outsider, board, member } = await setup();
    const real = routes(board.id, member.id);
    const fake = routes(MISSING, member.id);
    for (const [i, [method, path, body]] of real.entries()) {
      const a = await call(method, path, { cookie: outsider.cookie, body });
      const [, fakePath, fakeBody] = fake[i]!;
      const b = await call(method, fakePath, { cookie: outsider.cookie, body: fakeBody });
      expect(a.status, `${method} ${path}`).toBe(404);
      expect({ status: a.status, data: a.data }).toEqual({ status: b.status, data: b.data });
    }
  });

  it("rejects unauthenticated requests on every route", async () => {
    const { board, member } = await setup();
    for (const [method, path, body] of routes(board.id, member.id)) {
      expect((await call(method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
  });

  it("lets members read but forbids admin actions", async () => {
    const { member, board, admin } = await setup();
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie })).status).toBe(200);
    const forbidden: [string, string, unknown?][] = [
      ["PATCH", `/api/boards/${board.id}`, { name: "Hijack" }],
      ["POST", `/api/boards/${board.id}/invite/regenerate`],
      ["POST", `/api/boards/${board.id}/members/${member.id}/role`, { role: "admin" }],
      ["DELETE", `/api/boards/${board.id}/members/${admin.id}`],
    ];
    for (const [method, path, body] of forbidden) {
      expect((await call(method, path, { cookie: member.cookie, body })).status, `${method} ${path}`).toBe(403);
    }
    const view = await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie });
    expect(view.data.board.name).toBe("Study group");
  });

  it("rejects cross-origin and origin-less state changes", async () => {
    const { admin, board } = await setup();
    for (const origin of ["https://evil.example", null]) {
      const r = await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { name: "x" }, origin });
      expect(r.status).toBe(403);
    }
    expect((await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { name: "ok" }, origin: ORIGIN })).status).toBe(200);
  });

  it("does not let a kicked member keep reading", async () => {
    const { admin, member, board } = await setup();
    expect((await call("DELETE", `/api/boards/${board.id}/members/${member.id}`, { cookie: admin.cookie })).status).toBe(200);
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie })).status).toBe(404);
  });

  it("sends private, uncacheable board responses", async () => {
    const { admin, board } = await setup();
    const r = await call("GET", `/api/boards/${board.id}`, { cookie: admin.cookie });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("invites", () => {
  it("joins with a valid link, idempotently", async () => {
    const { outsider, board } = await setup();
    expect((await joinBoard(outsider, board)).status).toBe(201);
    const again = await joinBoard(outsider, board);
    expect(again.data.already_member).toBe(true);
  });

  it("previews a board without joining it", async () => {
    const { outsider, board } = await setup();
    const p = await call("POST", "/api/join/preview", { cookie: outsider.cookie, body: board.joinBody });
    expect(p.data).toMatchObject({ name: "Study group", member_count: 2, already_member: false });
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: outsider.cookie })).status).toBe(404);
  });

  it("gives identical 404s for wrong token, wrong board and disabled link", async () => {
    const { outsider, board, admin } = await setup();
    const wrongToken = await call("POST", "/api/join", { cookie: outsider.cookie, body: { board_id: board.id, token: "A".repeat(43) } });
    const wrongBoard = await call("POST", "/api/join", { cookie: outsider.cookie, body: { board_id: MISSING, token: board.token } });
    await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { invite_enabled: false } });
    const disabled = await joinBoard(outsider, board);
    for (const r of [wrongToken, wrongBoard, disabled]) expect(r.status).toBe(404);
    expect(wrongToken.data).toEqual(wrongBoard.data);
    expect(disabled.data).toEqual(wrongBoard.data);
  });

  it("re-enabling restores the same link; regenerating invalidates the old one", async () => {
    const { outsider, board, admin } = await setup();
    await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { invite_enabled: false } });
    await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { invite_enabled: true } });
    const regen = await call("POST", `/api/boards/${board.id}/invite/regenerate`, { cookie: admin.cookie });
    expect((await joinBoard(outsider, board)).status).toBe(404);
    const token = regen.data.join_path.split(".")[1];
    expect((await call("POST", "/api/join", { cookie: outsider.cookie, body: { board_id: board.id, token } })).status).toBe(201);
  });

  it("hides the link from members when disabled, but not from admins' settings", async () => {
    const { member, board, admin } = await setup();
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie })).data.join_path).toMatch(/^\/join#/);
    await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { invite_enabled: false } });
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie })).data.join_path).toBeNull();
  });

  it("enforces the member cap atomically", async () => {
    const { admin, board } = await setup();
    await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { member_cap: 4 } });
    const extra: TestUser[] = [];
    for (let i = 0; i < 4; i++) extra.push(await makeUser(`U${i}`));
    const results = await Promise.all(extra.map((u) => joinBoard(u, board)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.data.error === "board_full")).toHaveLength(2);
  });

  it("rate-limits join attempts", async () => {
    const { outsider, board } = await setup();
    let last = 0;
    for (let i = 0; i < 32; i++) {
      last = (await call("POST", "/api/join/preview", { cookie: outsider.cookie, body: { board_id: board.id, token: "A".repeat(43) } })).status;
    }
    expect(last).toBe(429);
  });
});

describe("admin rules", () => {
  it("never leaves a board without an admin", async () => {
    const { admin, member, board } = await setup();
    const demote = await call("POST", `/api/boards/${board.id}/members/${admin.id}/role`, { cookie: admin.cookie, body: { role: "member" } });
    expect(demote.data.error).toBe("last_admin");
    const leave = await call("POST", `/api/boards/${board.id}/leave`, { cookie: admin.cookie });
    expect(leave.data.error).toBe("last_admin");
    await call("POST", `/api/boards/${board.id}/members/${member.id}/role`, { cookie: admin.cookie, body: { role: "admin" } });
    expect((await call("POST", `/api/boards/${board.id}/leave`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("survives two admins demoting each other at once", async () => {
    const { admin, member, board } = await setup();
    await call("POST", `/api/boards/${board.id}/members/${member.id}/role`, { cookie: admin.cookie, body: { role: "admin" } });
    const [a, b] = await Promise.all([
      call("POST", `/api/boards/${board.id}/members/${member.id}/role`, { cookie: admin.cookie, body: { role: "member" } }),
      call("POST", `/api/boards/${board.id}/members/${admin.id}/role`, { cookie: member.cookie, body: { role: "member" } }),
    ]);
    // Whichever lands second is refused: 409 if the guard stops it, 403 if it had already lost admin rights.
    expect([a.status, b.status].filter((x) => x === 200)).toHaveLength(1);
    expect([a.status, b.status].find((x) => x !== 200)).toBeOneOf([403, 409]);
    const n = await db().prepare("SELECT COUNT(*) AS n FROM memberships WHERE board_id = ? AND role = 'admin'").bind(board.id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("deletes a board when its only member leaves", async () => {
    const admin = await makeUser();
    const board = await makeBoard(admin);
    expect((await call("POST", `/api/boards/${board.id}/leave`, { cookie: admin.cookie })).status).toBe(200);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM boards").first<{ n: number }>())?.n).toBe(0);
  });

  it("survives two admins removing each other at once", async () => {
    const { admin, member, board } = await setup();
    await call("POST", `/api/boards/${board.id}/members/${member.id}/role`, { cookie: admin.cookie, body: { role: "admin" } });
    await Promise.all([
      call("DELETE", `/api/boards/${board.id}/members/${member.id}`, { cookie: admin.cookie }),
      call("DELETE", `/api/boards/${board.id}/members/${admin.id}`, { cookie: member.cookie }),
    ]);
    const n = await db().prepare("SELECT COUNT(*) AS n FROM memberships WHERE board_id = ? AND role = 'admin'").bind(board.id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("admins can remove another admin while one admin remains", async () => {
    const { admin, member, board } = await setup();
    await call("POST", `/api/boards/${board.id}/members/${member.id}/role`, { cookie: admin.cookie, body: { role: "admin" } });
    expect((await call("DELETE", `/api/boards/${board.id}/members/${member.id}`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("admins cannot kick themselves", async () => {
    const { admin, board } = await setup();
    expect((await call("DELETE", `/api/boards/${board.id}/members/${admin.id}`, { cookie: admin.cookie })).data.error).toBe("use_leave");
  });

  it("validates board settings", async () => {
    const { admin, board } = await setup();
    for (const body of [{ member_cap: 0 }, { member_cap: "5" }, { invite_enabled: "yes" }, { name: "<b>" }, {}]) {
      expect((await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body })).status).toBe(400);
    }
    expect((await call("PATCH", `/api/boards/${board.id}`, { cookie: admin.cookie, body: { member_cap: null } })).status).toBe(200);
  });
});

describe("leaderboard", () => {
  it("ranks by today then 7-day total and bounds the window", async () => {
    const { admin, member, board } = await setup();
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    // The add-on only ever pushes today, so history is seeded directly.
    const seed = (u: TestUser, d: string, n: number) =>
      db().prepare("INSERT INTO daily_stats (user_id, local_date, review_count, updated_at) VALUES (?, ?, ?, ?)").bind(u.id, d, n, Date.now()).run();
    await seed(admin, day(3), 100);
    await seed(admin, day(7), 999); // outside the 7-day window
    await pushStats(admin, 30, day(0));
    await pushStats(member, 80, day(0));
    const view = await call("GET", `/api/boards/${board.id}`, { cookie: admin.cookie });
    expect(view.data.members.map((m: any) => [m.display_name, m.rank, m.today, m.week])).toEqual([
      ["Member", 1, 80, 80],
      ["Admin", 2, 30, 130],
    ]);
  });

  it("returns the top 100 plus the caller's own row", async () => {
    const { admin, board } = await setup();
    const now = Date.now();
    const stmts = [];
    for (let i = 0; i < 120; i++) {
      const id = i.toString(16).padStart(32, "0");
      stmts.push(db().prepare("INSERT INTO users (id, secret_hash, display_name, created_at, last_active_date) VALUES (?, ?, ?, ?, ?)").bind(id, `h${i}`, `P${i}`, now, today()));
      stmts.push(db().prepare("INSERT INTO memberships (board_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(board.id, id, now));
      stmts.push(db().prepare("INSERT INTO daily_stats (user_id, local_date, review_count, updated_at) VALUES (?, ?, ?, ?)").bind(id, today(), 100 + i, now));
    }
    await db().batch(stmts);
    const view = await call("GET", `/api/boards/${board.id}`, { cookie: admin.cookie });
    expect(view.data.members).toHaveLength(101);
    expect(view.data.members.at(-1)).toMatchObject({ is_me: true, display_name: "Admin" });
    expect(view.data.board.member_count).toBe(122);
  });

  it("validates the date parameter", async () => {
    const { admin, board } = await setup();
    expect((await call("GET", `/api/boards/${board.id}?date=nope`, { cookie: admin.cookie })).status).toBe(400);
    expect((await call("GET", `/api/boards/${board.id}?date=2001-01-01`, { cookie: admin.cookie })).status).toBe(400);
  });

  it("cannot be hit with a non-hex board id", async () => {
    const { admin } = await setup();
    expect((await call("GET", "/api/boards/..%2Fadmin", { cookie: admin.cookie })).status).toBe(404);
    expect((await call("GET", "/api/boards/' OR 1=1 --", { cookie: admin.cookie })).status).toBe(404);
  });
});

describe("deleting a board", () => {
  const del = (boardId: string, cookie: string, confirm: unknown) =>
    call("POST", `/api/boards/${boardId}/delete`, { cookie, body: { confirm } });

  it("lets an admin delete it, removing it for every member but keeping their accounts and stats", async () => {
    const { admin, member, board } = await setup();
    await pushStats(member, 30);
    expect((await del(board.id, admin.cookie, "Study group")).status).toBe(200);
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie })).status).toBe(404);
    expect((await call("GET", "/api/me", { cookie: member.cookie })).data.boards).toEqual([]);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM memberships").first<{ n: number }>())?.n).toBe(0);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(3);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM daily_stats WHERE user_id = ?").bind(member.id).first<{ n: number }>())?.n).toBe(1);
  });

  it("needs the exact board name as confirmation", async () => {
    const { admin, board } = await setup();
    for (const confirm of [undefined, "", "study group", "Study group ", 5]) {
      expect((await del(board.id, admin.cookie, confirm)).status, String(confirm)).toBe(400);
    }
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("is refused for members and hidden from non-members", async () => {
    const { member, outsider, board } = await setup();
    expect((await del(board.id, member.cookie, "Study group")).status).toBe(403);
    expect((await del(board.id, outsider.cookie, "Study group")).status).toBe(404);
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie })).status).toBe(200);
  });

  it("rejects a cross-origin request", async () => {
    const { admin, board } = await setup();
    const r = await call("POST", `/api/boards/${board.id}/delete`, { cookie: admin.cookie, origin: "https://evil.example", body: { confirm: "Study group" } });
    expect(r.status).toBe(403);
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: admin.cookie })).status).toBe(200);
  });

  it("invalidates its invite link", async () => {
    const { admin, board, outsider } = await setup();
    await del(board.id, admin.cookie, "Study group");
    expect((await joinBoard(outsider, board)).status).toBe(404);
  });
});
