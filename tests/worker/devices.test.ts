import { describe, expect, it } from "vitest";
import { call, db, makeUser, newSecret, ORIGIN, today } from "./helpers";

const SHAPE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){2}$/;

const linkCode = (secret: string) => call("POST", "/api/link-code", { secret });
const link = (code: unknown, secret: string = newSecret(), ip = "203.0.113.70", label?: string) =>
  call("POST", "/api/link", { ip, body: { link_code: code, new_secret: secret, ...(label ? { device_label: label } : {}) } });
const push = (secret: string, count: number) => db().prepare("UPDATE users SET last_push_at = NULL").run().then(() => call("POST", "/api/sync", { secret, body: { local_date: today(), review_count: count } }));
const devices = (cookie: string) => call("GET", "/api/devices", { cookie });

async function signIn(secret: string) {
  const l = await call("POST", "/api/login-link", { secret });
  const consume = await call("POST", "/api/login-link/consume", { body: { token: l.data.token }, origin: ORIGIN });
  return consume.headers.get("Set-Cookie")!.split(";")[0]!;
}

describe("computers on an account", () => {
  it("registers a first computer with a label, and defaults it", async () => {
    const a = await call("POST", "/api/register", { secret: newSecret(), body: { display_name: "Labelled", device_label: "Macbook (macOS)" }, ip: "198.51.100.150" });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/register", { secret: newSecret(), body: { display_name: "Plain" }, ip: "198.51.100.151" });
    const rows = await db().prepare("SELECT label FROM devices ORDER BY label").all<{ label: string }>();
    expect(rows.results.map((r) => r.label)).toEqual(["Macbook (macOS)", "This computer"]);
    expect(b.status).toBe(201);
    const bad = await call("POST", "/api/register", { secret: newSecret(), body: { display_name: "Bad", device_label: "<script>" }, ip: "198.51.100.152" });
    expect(bad.status).toBe(400);
  });

  it("is idempotent for a computer that is already known", async () => {
    const u = await makeUser("Again");
    const r = await call("POST", "/api/register", { secret: u.secret, body: { display_name: "Again" } });
    expect(r.data).toMatchObject({ user_id: u.id, created: false });
    expect((await db().prepare("SELECT COUNT(*) AS n FROM devices").first<{ n: number }>())?.n).toBe(1);
  });
});

describe("linking another computer", () => {
  it("needs a known computer to make a code, and the code is short, hashed and expires", async () => {
    expect((await call("POST", "/api/link-code", {})).status).toBe(401);
    const u = await makeUser("First");
    const r = await linkCode(u.secret);
    expect(r.status).toBe(201);
    expect(r.data.code).toMatch(SHAPE);
    expect(r.data.expires_in_seconds).toBe(600);
    const plain = r.data.code.replaceAll("-", "");
    expect(JSON.stringify(await db().prepare("SELECT * FROM link_codes").all())).not.toContain(plain);
  });

  it("adds the second computer to the same account, and both can push", async () => {
    const first = await makeUser("Shared");
    const code = (await linkCode(first.secret)).data.code;
    const secondSecret = newSecret();
    const r = await link(code, secondSecret, "203.0.113.70", "Laptop (Windows)");
    expect(r.status).toBe(201);
    expect(r.data.display_name).toBe("Shared");
    expect((await push(first.secret, 40)).status).toBe(200);
    expect((await push(secondSecret, 90)).status).toBe(200); // the count only goes up, whichever computer sends it
    expect((await push(first.secret, 60)).status).toBe(200);
    const stat = await db().prepare("SELECT review_count FROM daily_stats WHERE user_id = ?").bind(first.id).first<{ review_count: number }>();
    expect(stat?.review_count).toBe(90);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(1);
    const cookie = await signIn(secondSecret);
    expect((await devices(cookie)).data.devices.map((d: { label: string }) => d.label).sort()).toEqual(["Laptop (Windows)", "This computer"]);
  });

  it("works once, even if two computers try at the same moment", async () => {
    const u = await makeUser("Once");
    const code = (await linkCode(u.secret)).data.code;
    const [a, b] = await Promise.all([link(code, newSecret(), "203.0.113.71"), link(code, newSecret(), "203.0.113.72")]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect((await link(code, newSecret(), "203.0.113.73")).status).toBe(400);
  });

  it("expires after ten minutes, and a newer code cancels the older one", async () => {
    const u = await makeUser("Timed");
    const old = (await linkCode(u.secret)).data.code;
    const newer = (await linkCode(u.secret)).data.code;
    expect((await link(old)).status).toBe(400);
    await db().prepare("UPDATE link_codes SET expires_at = ?").bind(Date.now() - 1000).run();
    expect((await link(newer)).status).toBe(400);
  });

  it("answers every bad code the same way", async () => {
    const u = await makeUser("Quiet");
    await linkCode(u.secret);
    const replies = [];
    for (const code of ["AAAA-AAAA-AAAA", "short", "", null, undefined, 123, "x".repeat(200), "AAAA-AAAA-AAA1"]) {
      replies.push(await link(code, newSecret(), `203.0.113.${80 + replies.length}`));
    }
    for (const r of replies) expect({ status: r.status, error: r.data.error }).toEqual({ status: 400, error: "invalid_link_code" });
  });

  it("accepts the code as typed, and rejects a bad key or one already in use", async () => {
    const u = await makeUser("Typist");
    const other = await makeUser("Other");
    const code: string = (await linkCode(u.secret)).data.code;
    expect((await link(code, "short")).data.error).toBe("invalid_secret");
    expect((await link(code, other.secret)).data.error).toBe("secret_in_use");
    expect((await link(code.toLowerCase().replaceAll("-", " "))).status).toBe(201); // earlier failures did not spend it
  });

  it("limits attempts per address and codes per user", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await link("AAAA-AAAA-AAAA", newSecret(), "203.0.113.99")).status;
    expect(last).toBe(429);
    const u = await makeUser("Eager");
    for (let i = 0; i < 5; i++) expect((await linkCode(u.secret)).status).toBe(201);
    expect((await linkCode(u.secret)).status).toBe(429);
  });

  it("caps an account at ten computers", async () => {
    const u = await makeUser("Crowded");
    for (let i = 0; i < 9; i++) {
      await db().prepare("DELETE FROM rate_limits").run();
      const code = (await linkCode(u.secret)).data.code;
      expect((await link(code, newSecret(), `203.0.113.${100 + i}`)).status).toBe(201);
    }
    await db().prepare("DELETE FROM rate_limits").run();
    const code = (await linkCode(u.secret)).data.code;
    expect((await link(code, newSecret(), "203.0.113.150")).data.error).toBe("too_many_devices");
  });
});

describe("managing computers", () => {
  async function pair() {
    const first = await makeUser("Pair");
    const code = (await linkCode(first.secret)).data.code;
    const secondSecret = newSecret();
    await link(code, secondSecret);
    return { first, secondSecret };
  }

  it("lets the owner remove a computer, which then stops working while the other carries on", async () => {
    const { first, secondSecret } = await pair();
    const cookie = await signIn(first.secret);
    const list = (await devices(cookie)).data.devices as { id: string }[];
    const secondId = (await db().prepare("SELECT id FROM devices WHERE secret_hash <> (SELECT secret_hash FROM devices ORDER BY created_at LIMIT 1)").first<{ id: string }>())!.id;
    expect(list.map((d) => d.id)).toContain(secondId);
    expect((await call("DELETE", `/api/devices/${secondId}`, { cookie })).status).toBe(200);
    expect((await push(secondSecret, 5)).status).toBe(401);
    expect((await push(first.secret, 5)).status).toBe(200);
  });

  it("never removes the last computer, and refuses cross-origin or signed-out requests", async () => {
    const solo = await makeUser("Solo");
    const cookie = solo.cookie;
    const only = (await db().prepare("SELECT id FROM devices").first<{ id: string }>())!.id;
    expect((await call("DELETE", `/api/devices/${only}`, { cookie })).data.error).toBe("last_device");
    expect((await call("DELETE", `/api/devices/${only}`, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("DELETE", `/api/devices/${only}`)).status).toBe(401);
    expect((await call("GET", "/api/devices")).status).toBe(401);
  });

  it("will not touch another account's computers, and says so the same way as for a missing one", async () => {
    const { first } = await pair();
    const stranger = await makeUser("Stranger");
    const firstDevice = (await db().prepare("SELECT id FROM devices WHERE user_id = ?").bind(first.id).first<{ id: string }>())!.id;
    const theirs = await call("DELETE", `/api/devices/${firstDevice}`, { cookie: stranger.cookie });
    const missing = await call("DELETE", `/api/devices/${"0".repeat(32)}`, { cookie: stranger.cookie });
    expect({ status: theirs.status, data: theirs.data }).toEqual({ status: missing.status, data: missing.data });
    expect(theirs.status).toBe(404);
    expect((await call("GET", "/api/devices", { cookie: stranger.cookie })).data.devices).toHaveLength(1);
  });

  it("changes only this computer's key on a reset", async () => {
    const { first, secondSecret } = await pair();
    const fresh = newSecret();
    expect((await call("POST", "/api/identity/rotate", { secret: first.secret, body: { new_secret: fresh } })).status).toBe(200);
    expect((await push(first.secret, 5)).status).toBe(401);
    expect((await push(fresh, 5)).status).toBe(200);
    expect((await push(secondSecret, 6)).status).toBe(200); // the other computer is untouched
  });

  it("restoring with a recovery code cancels every other computer", async () => {
    const { first, secondSecret } = await pair();
    const code = (await call("POST", "/api/me/recovery-code", { cookie: await signIn(first.secret) })).data.code;
    const fresh = newSecret();
    const r = await call("POST", "/api/recover", { ip: "203.0.113.60", body: { recovery_code: code, new_secret: fresh, device_label: "Rebuilt" } });
    expect(r.status).toBe(200);
    expect((await push(first.secret, 5)).status).toBe(401);
    expect((await push(secondSecret, 5)).status).toBe(401);
    expect((await push(fresh, 5)).status).toBe(200);
    expect((await db().prepare("SELECT label FROM devices").all<{ label: string }>()).results.map((d) => d.label)).toEqual(["Rebuilt"]);
  });

  it("removes the computers with the account", async () => {
    const { first } = await pair();
    const cookie = await signIn(first.secret);
    expect((await call("POST", "/api/me/delete", { cookie, body: { confirm: "delete" } })).status).toBe(200);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM devices").first<{ n: number }>())?.n).toBe(0);
  });

  it("stores only hashes of computer keys", async () => {
    const u = await makeUser("Hashed");
    expect(JSON.stringify(await db().prepare("SELECT * FROM devices").all())).not.toContain(u.secret);
  });
});
