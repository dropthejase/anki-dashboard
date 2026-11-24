import { describe, expect, it } from "vitest";
import { call, db, makeUser, newSecret, ORIGIN, pushStats, today } from "./helpers";

describe("registration", () => {
  it("creates an identity and is idempotent for the same secret", async () => {
    const secret = newSecret();
    const a = await call("POST", "/api/register", { secret, body: { display_name: "Alice" } });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/register", { secret, body: { display_name: "Different" } });
    expect(b.status).toBe(200);
    expect(b.data).toMatchObject({ user_id: a.data.user_id, display_name: "Alice", created: false });
  });

  it("stores only a hash of the secret", async () => {
    const secret = newSecret();
    await call("POST", "/api/register", { secret, body: { display_name: "Alice" } });
    const rows = await db().prepare("SELECT * FROM users").all();
    expect(JSON.stringify(rows.results)).not.toContain(secret);
  });

  it("rejects missing or malformed secrets with the same 401", async () => {
    for (const secret of [undefined, "short", "x".repeat(44), `${"a".repeat(42)}!`]) {
      const r = await call("POST", "/api/register", { secret, body: { display_name: "Alice" } });
      expect(r.status).toBe(401);
      expect(r.data).toEqual({ error: "unknown_identity" });
    }
  });

  it("rejects hostile display names", async () => {
    for (const name of ["<img src=x onerror=alert(1)>", "a‮b", "", "x".repeat(31), "bell\u0007", 5]) {
      const r = await call("POST", "/api/register", { secret: newSecret(), body: { display_name: name } });
      expect(r.status, JSON.stringify(name)).toBe(400);
    }
  });

  it("rate-limits registrations per IP", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await call("POST", "/api/register", { secret: newSecret(), body: { display_name: "Bot" }, ip: "192.0.2.9" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("sync", () => {
  it("requires a known identity", async () => {
    const r = await call("POST", "/api/sync", { secret: newSecret(), body: { local_date: today(), review_count: 5 } });
    expect(r.status).toBe(401);
  });

  it("stores the count and keeps the maximum on repeat pushes", async () => {
    const u = await makeUser();
    expect((await pushStats(u, 40)).status).toBe(200);
    expect((await pushStats(u, 25)).status).toBe(200);
    const row = await db().prepare("SELECT review_count FROM daily_stats WHERE user_id = ?").bind(u.id).first<{ review_count: number }>();
    expect(row?.review_count).toBe(40);
    await pushStats(u, 90);
    const after = await db().prepare("SELECT review_count FROM daily_stats WHERE user_id = ?").bind(u.id).first<{ review_count: number }>();
    expect(after?.review_count).toBe(90);
  });

  it("rejects over-cap, negative, fractional and non-numeric counts", async () => {
    const u = await makeUser();
    const cases: [unknown, string][] = [[10_001, "over_cap"], [-1, "invalid_count"], [1.5, "invalid_count"], ["9", "invalid_count"]];
    for (const [count, error] of cases) {
      const r = await pushStats(u, count as number);
      expect(r.data.error, String(count)).toBe(error);
    }
    expect((await pushStats(u, 10_000)).status).toBe(200);
  });

  it("rejects impossible or implausible dates", async () => {
    const u = await makeUser();
    for (const d of ["2026-02-30", "yesterday", "2020-01-01", "2099-01-01", 20260101]) {
      expect((await pushStats(u, 5, d as string)).status, String(d)).toBe(400);
    }
  });

  it("enforces the 5-minute minimum push interval", async () => {
    const u = await makeUser();
    expect((await pushStats(u, 5)).status).toBe(200);
    const again = await call("POST", "/api/sync", { secret: u.secret, body: { local_date: today(), review_count: 6 } });
    expect(again.status).toBe(429);
    expect(again.data.error).toBe("too_soon");
  });
});

describe("login links and sessions", () => {
  async function link(secret: string) {
    return (await call("POST", "/api/login-link", { secret })).data.token as string;
  }

  it("signs in once, then rejects reuse", async () => {
    const u = await makeUser();
    const token = await link(u.secret);
    expect((await call("POST", "/api/login-link/consume", { body: { token }, origin: ORIGIN })).status).toBe(200);
    expect((await call("POST", "/api/login-link/consume", { body: { token }, origin: ORIGIN })).status).toBe(400);
  });

  it("rejects an expired link", async () => {
    const u = await makeUser();
    const token = await link(u.secret);
    await db().prepare("UPDATE login_links SET expires_at = 1").run();
    expect((await call("POST", "/api/login-link/consume", { body: { token }, origin: ORIGIN })).status).toBe(400);
    expect((await call("POST", "/api/login-link/inspect", { body: { token }, origin: ORIGIN })).status).toBe(400);
  });

  it("inspect names the account without consuming the link", async () => {
    const u = await makeUser("Bea");
    const token = await link(u.secret);
    const peek = await call("POST", "/api/login-link/inspect", { body: { token }, origin: ORIGIN });
    expect(peek.data).toEqual({ display_name: "Bea" });
    expect((await call("POST", "/api/login-link/consume", { body: { token }, origin: ORIGIN })).status).toBe(200);
  });

  it("rejects guessed tokens and cross-origin consumption", async () => {
    const u = await makeUser();
    const token = await link(u.secret);
    expect((await call("POST", "/api/login-link/consume", { body: { token: "A".repeat(22) }, origin: ORIGIN })).status).toBe(400);
    expect((await call("POST", "/api/login-link/consume", { body: { token }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/login-link/consume", { body: { token }, origin: null })).status).toBe(403);
  });

  it("sets a hardened session cookie and stores only its hash", async () => {
    const u = await makeUser();
    const token = await link(u.secret);
    const r = await call("POST", "/api/login-link/consume", { body: { token }, origin: ORIGIN });
    const cookie = r.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^__Host-session=/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) expect(cookie).toContain(attr);
    const sid = cookie.split(";")[0]!.split("=")[1]!;
    expect(JSON.stringify((await db().prepare("SELECT * FROM sessions").all()).results)).not.toContain(sid);
    expect(JSON.stringify((await db().prepare("SELECT * FROM login_links").all()).results)).not.toContain(token);
  });

  it("returns the signed-in user, and 401 without a session", async () => {
    const u = await makeUser("Cy");
    expect((await call("GET", "/api/me", { cookie: u.cookie })).data.user.display_name).toBe("Cy");
    expect((await call("GET", "/api/me")).status).toBe(401);
    expect((await call("GET", "/api/me", { cookie: "__Host-session=forged" })).status).toBe(401);
  });

  it("logs out", async () => {
    const u = await makeUser();
    expect((await call("POST", "/api/logout", { cookie: u.cookie })).status).toBe(200);
    expect((await call("GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
  });

  it("expires sessions after the absolute maximum", async () => {
    const u = await makeUser();
    await db().prepare("UPDATE sessions SET created_at = created_at - ?").bind(91 * 86_400_000).run();
    expect((await call("GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
  });

  it("rotating the secret revokes the old one and all sessions", async () => {
    const u = await makeUser();
    const next = newSecret();
    expect((await call("POST", "/api/identity/rotate", { secret: u.secret, body: { new_secret: next } })).status).toBe(200);
    expect((await call("POST", "/api/sync", { secret: u.secret, body: { local_date: today(), review_count: 1 } })).status).toBe(401);
    expect((await call("GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
    expect((await call("POST", "/api/login-link", { secret: next })).status).toBe(201);
  });
});

describe("account", () => {
  it("deleting an account removes all of its rows", async () => {
    const u = await makeUser();
    await pushStats(u, 12);
    const r = await call("POST", "/api/me/delete", { cookie: u.cookie, body: { confirm: "delete" } });
    expect(r.status).toBe(200);
    for (const t of ["users", "daily_stats", "sessions", "login_links", "memberships"]) {
      expect((await db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n, t).toBe(0);
    }
  });

  it("requires explicit confirmation and a same-origin request", async () => {
    const u = await makeUser();
    expect((await call("POST", "/api/me/delete", { cookie: u.cookie, body: {} })).status).toBe(400);
    expect((await call("POST", "/api/me/delete", { cookie: u.cookie, body: { confirm: "delete" }, origin: "https://evil.example" })).status).toBe(403);
  });
});


describe("input protections", () => {
  it("rejects stacked combining marks but accepts ordinary accents and scripts", async () => {
    const zalgo = `Z${"\u0300\u0301\u0302\u0303\u0304"}a`;
    const bad = await call("POST", "/api/register", { secret: newSecret(), body: { display_name: zalgo }, ip: "198.51.100.200" });
    expect(bad.status).toBe(400);
    for (const [i, name] of ["José", "Zoë", "日本語", "สวัสดี", "Åsa 😀"].entries()) {
      const ok = await call("POST", "/api/register", { secret: newSecret(), body: { display_name: name }, ip: `198.51.100.${201 + i}` });
      expect(ok.status, name).toBe(201);
    }
  });

  it("limits how many changes one signed-in user can make per hour", async () => {
    const u = await makeUser("Busy");
    let last = 200;
    for (let i = 0; i < 205 && last !== 429; i++) {
      last = (await call("PATCH", "/api/me", { cookie: u.cookie, body: { display_name: `Busy ${i % 9}` } })).status;
    }
    expect(last).toBe(429);
    // Reading is unaffected.
    expect((await call("GET", "/api/me", { cookie: u.cookie })).status).toBe(200);
  });
});
