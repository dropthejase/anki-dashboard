import { describe, expect, it } from "vitest";
import { call, joinBoard, makeBoard, makeUser, ORIGIN, rawFetch } from "./helpers";
import { env } from "cloudflare:workers";

/** A stand-in for a JPEG: the right start and end markers around some bytes. The server checks only these. */
function jpeg(size = 2000): Uint8Array {
  const b = new Uint8Array(size).fill(7);
  b.set([0xff, 0xd8, 0xff], 0);
  b.set([0xff, 0xd9], size - 2);
  return b;
}

const send = (method: string, path: string, cookie: string, body?: Uint8Array, type = "image/jpeg") =>
  rawFetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.1", ...(body ? { "Content-Type": type } : {}) },
      body,
    }),
  );

async function setup() {
  const admin = await makeUser("Admin");
  const member = await makeUser("Member");
  const outsider = await makeUser("Outsider");
  const board = await makeBoard(admin);
  await joinBoard(member, board);
  return { admin, member, outsider, board };
}

describe("board picture", () => {
  it("lets an admin set it, and members and the board lists see its version", async () => {
    const { admin, member, board } = await setup();
    expect((await send("PUT", `/api/boards/${board.id}/image`, admin.cookie, jpeg())).status).toBe(200);
    const view = await call("GET", `/api/boards/${board.id}`, { cookie: member.cookie });
    expect(view.data.board.image_version).toEqual(expect.any(Number));
    const me = await call("GET", "/api/me", { cookie: member.cookie });
    expect(me.data.boards[0].image_version).toBe(view.data.board.image_version);
  });

  it("serves the bytes to members only, always as a sandboxed JPEG", async () => {
    const { admin, member, outsider, board } = await setup();
    await send("PUT", `/api/boards/${board.id}/image`, admin.cookie, jpeg(1234));
    const ok = await send("GET", `/api/boards/${board.id}/image`, member.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ok.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await ok.arrayBuffer()).byteLength).toBe(1234);
    expect((await send("GET", `/api/boards/${board.id}/image`, outsider.cookie)).status).toBe(404);
    expect((await call("GET", `/api/boards/${board.id}/image`)).status).toBe(401);
  });

  it("is admin only, and a plain member cannot set or remove it", async () => {
    const { admin, member, board } = await setup();
    expect((await send("PUT", `/api/boards/${board.id}/image`, member.cookie, jpeg())).status).toBe(403);
    await send("PUT", `/api/boards/${board.id}/image`, admin.cookie, jpeg());
    expect((await send("DELETE", `/api/boards/${board.id}/image`, member.cookie)).status).toBe(403);
    expect((await send("GET", `/api/boards/${board.id}/image`, member.cookie)).status).toBe(200);
  });

  it("rejects anything that is not a small JPEG", async () => {
    const { admin, board } = await setup();
    const path = `/api/boards/${board.id}/image`;
    const png = new Uint8Array(500).fill(1);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    expect((await send("PUT", path, admin.cookie, png)).status).toBe(400);
    expect((await send("PUT", path, admin.cookie, jpeg(50))).status).toBe(400); // too small to be real
    expect((await send("PUT", path, admin.cookie, jpeg(48 * 1024 + 1))).status).toBe(413);
    expect((await send("PUT", path, admin.cookie, jpeg(), "text/html")).status).toBe(415);
    const noEnd = jpeg();
    noEnd[noEnd.length - 1] = 0;
    expect((await send("PUT", path, admin.cookie, noEnd)).status).toBe(400);
    expect((await send("GET", path, admin.cookie)).status).toBe(404);
  });

  it("changes the version when replaced, and goes away when removed or the board is deleted", async () => {
    const { admin, board } = await setup();
    const path = `/api/boards/${board.id}/image`;
    const first = await (await send("PUT", path, admin.cookie, jpeg())).json<{ image_version: number }>();
    await new Promise((r) => setTimeout(r, 5));
    const second = await (await send("PUT", path, admin.cookie, jpeg(3000))).json<{ image_version: number }>();
    expect(second.image_version).toBeGreaterThan(first.image_version);
    expect((await send("DELETE", path, admin.cookie)).status).toBe(200);
    expect((await send("GET", path, admin.cookie)).status).toBe(404);
    expect((await call("GET", `/api/boards/${board.id}`, { cookie: admin.cookie })).data.board.image_version).toBeNull();
    await send("PUT", path, admin.cookie, jpeg());
    await call("POST", `/api/boards/${board.id}/delete`, { cookie: admin.cookie, body: { confirm: "Study group" } });
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_images").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
