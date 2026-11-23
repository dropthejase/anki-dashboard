import { describe, expect, it } from "vitest";
import { inviteToken } from "../../src/crypto";
import { call, makeUser, newSecret, rawFetch } from "./helpers";

describe("invite key", () => {
  it("refuses to sign anything with a missing or short key", async () => {
    for (const key of [undefined, "", "short", "x".repeat(31)]) {
      await expect(inviteToken(key as unknown as string, "a".repeat(32), 0), String(key)).rejects.toMatchObject({ status: 500, code: "server_misconfigured" });
    }
    await expect(inviteToken("k".repeat(32), "a".repeat(32), 0)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("request bodies", () => {
  const secret = newSecret();

  it("rejects an oversized body whether or not it declares a length", async () => {
    const big = { display_name: "x".repeat(6000) };
    const declared = await call("POST", "/api/register", { secret, body: big });
    expect(declared.status).toBe(413);
    expect(declared.data.error).toBe("body_too_large");
    // A streamed body has no Content-Length, so the limit must hold while reading.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"display_name":"'));
        for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode("y".repeat(1000)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const res = await rawFetch(
      new Request("https://leaderboard.test/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: stream,
        // @ts-expect-error duplex is required for streamed request bodies
        duplex: "half",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("still accepts a normal body", async () => {
    const u = await makeUser("Normal");
    expect((await call("PATCH", "/api/me", { cookie: u.cookie, body: { display_name: "Fine" } })).status).toBe(200);
  });
});

describe("logout", () => {
  it("only reads the real session cookie, not a lookalike", async () => {
    const u = await makeUser("Cookie");
    const real = u.cookie.split("=")[1]!;
    const lookalike = `evil__Host-session=${real}`;
    const res = await call("POST", "/api/logout", { cookie: `${u.cookie}; ${lookalike}` });
    expect(res.status).toBe(200);
    expect((await call("GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
  });
});
