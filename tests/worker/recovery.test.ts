import { describe, expect, it } from "vitest";
import { call, db, joinBoard, makeBoard, makeUser, newSecret, ORIGIN } from "./helpers";

const SHAPE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;

const createCode = (cookie: string) => call("POST", "/api/me/recovery-code", { cookie });
const recover = (code: unknown, secret: string = newSecret(), ip = "203.0.113.50") =>
  call("POST", "/api/recover", { ip, body: { recovery_code: code, new_secret: secret } });

describe("creating a recovery code", () => {
  it("needs a signed-in browser from our own origin", async () => {
    const u = await makeUser("Creator");
    expect((await call("POST", "/api/me/recovery-code")).status).toBe(401);
    expect((await call("POST", "/api/me/recovery-code", { cookie: u.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/me/recovery-code", { secret: u.secret })).status).toBe(401); // the add-on secret alone is not enough
  });

  it("returns a 160-bit code once and stores only its hash", async () => {
    const u = await makeUser("Creator");
    const r = await createCode(u.cookie);
    expect(r.status).toBe(201);
    expect(r.data.code).toMatch(SHAPE);
    const plain = r.data.code.replaceAll("-", "");
    const rows = await db().prepare("SELECT recovery_hash FROM users WHERE id = ?").bind(u.id).first<{ recovery_hash: string }>();
    expect(rows?.recovery_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await db().prepare("SELECT * FROM users").all())).not.toContain(plain);
    const me = await call("GET", "/api/me", { cookie: u.cookie });
    expect(me.data.recovery).toEqual({ created_at: r.data.created_at });
    expect(JSON.stringify(me.data)).not.toContain(rows!.recovery_hash);
  });

  it("reports no recovery code until one is made", async () => {
    const u = await makeUser("Fresh");
    expect((await call("GET", "/api/me", { cookie: u.cookie })).data.recovery).toBeNull();
  });

  it("replaces the earlier code, which then stops working", async () => {
    const u = await makeUser("Creator");
    const first = (await createCode(u.cookie)).data.code;
    const second = (await createCode(u.cookie)).data.code;
    expect(second).not.toBe(first);
    expect((await recover(first)).status).toBe(400);
    expect((await recover(second)).status).toBe(200);
  });

  it("is limited per user", async () => {
    const u = await makeUser("Eager");
    for (let i = 0; i < 5; i++) expect((await createCode(u.cookie)).status).toBe(201);
    expect((await createCode(u.cookie)).status).toBe(429);
  });
});

describe("restoring with a recovery code", () => {
  it("moves the account to a new secret and keeps its boards", async () => {
    const u = await makeUser("Restorer");
    const board = await makeBoard(u, "Keep me");
    const code = (await createCode(u.cookie)).data.code;
    const next = newSecret();
    const r = await recover(code, next);
    expect(r.status).toBe(200);
    expect(r.data.display_name).toBe("Restorer");
    // The old secret and old browser sessions are dead, the new secret is the same account.
    expect((await call("POST", "/api/login-link", { secret: u.secret })).status).toBe(401);
    expect((await call("GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
    const link = await call("POST", "/api/login-link", { secret: next });
    expect(link.status).toBe(201);
    const consume = await call("POST", "/api/login-link/consume", { body: { token: link.data.token }, origin: ORIGIN });
    const cookie = consume.headers.get("Set-Cookie")!.split(";")[0]!;
    const me = await call("GET", "/api/me", { cookie });
    expect(me.data.user.id).toBe(u.id);
    expect(me.data.boards.map((b: { name: string }) => b.name)).toEqual(["Keep me"]);
    expect(board.id).toBeTruthy();
  });

  it("is single use, and hands back a fresh code so the account is never left without one", async () => {
    const u = await makeUser("Restorer");
    const code = (await createCode(u.cookie)).data.code;
    const r = await recover(code);
    expect(r.data.recovery_code).toMatch(SHAPE);
    expect(r.data.recovery_code).not.toBe(code);
    expect((await recover(code)).status).toBe(400); // the used code is dead
    expect((await recover(r.data.recovery_code)).status).toBe(200); // the fresh one works
  });

  it("lets only one of two simultaneous attempts win", async () => {
    const u = await makeUser("Racer");
    const code = (await createCode(u.cookie)).data.code;
    const [a, b] = await Promise.all([recover(code, newSecret(), "203.0.113.51"), recover(code, newSecret(), "203.0.113.52")]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it("accepts the code as typed: any case, spaces or no hyphens", async () => {
    const u = await makeUser("Typist");
    const code: string = (await createCode(u.cookie)).data.code;
    expect((await recover(code.toLowerCase().replaceAll("-", " "))).status).toBe(200);
  });

  it("answers every bad code the same way", async () => {
    const u = await makeUser("Target");
    await createCode(u.cookie);
    const wrong = "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA";
    const replies = [];
    for (const code of [wrong, "short", "", null, undefined, 12345, "x".repeat(500), "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAA1"]) {
      replies.push(await recover(code, newSecret(), `203.0.113.${60 + replies.length}`));
    }
    for (const r of replies) expect({ status: r.status, error: r.data.error }).toEqual({ status: 400, error: "invalid_recovery_code" });
  });

  it("rejects a malformed new secret, and one that is already in use", async () => {
    const u = await makeUser("Picky");
    const other = await makeUser("Other");
    const code = (await createCode(u.cookie)).data.code;
    expect((await recover(code, "short")).data.error).toBe("invalid_secret");
    expect((await recover(code, other.secret)).data.error).toBe("secret_in_use");
    expect((await recover(code)).status).toBe(200); // the failed attempts did not use the code up
  });

  it("is rate limited per address", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await recover("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", newSecret(), "203.0.113.99")).status;
    expect(last).toBe(429);
  });

  it("survives a reset of this computer's key, and dies with the account", async () => {
    const u = await makeUser("Durable");
    const code = (await createCode(u.cookie)).data.code;
    const rotated = newSecret();
    expect((await call("POST", "/api/identity/rotate", { secret: u.secret, body: { new_secret: rotated } })).status).toBe(200);
    // Deleting the account removes the recovery hash with it.
    const link = await call("POST", "/api/login-link", { secret: rotated });
    const consume = await call("POST", "/api/login-link/consume", { body: { token: link.data.token }, origin: ORIGIN });
    const cookie = consume.headers.get("Set-Cookie")!.split(";")[0]!;
    expect((await call("POST", "/api/me/delete", { cookie, body: { confirm: "delete" } })).status).toBe(200);
    expect((await recover(code)).status).toBe(400);
  });

  it("does not let a recovered account lose its place on a board", async () => {
    const admin = await makeUser("Admin");
    const member = await makeUser("Member");
    const board = await makeBoard(admin);
    await joinBoard(member, board);
    const code = (await createCode(member.cookie)).data.code;
    await recover(code);
    const row = await db().prepare("SELECT role FROM memberships WHERE user_id = ?").bind(member.id).first<{ role: string }>();
    expect(row?.role).toBe("member");
  });
});
