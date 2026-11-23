import * as account from "./account";
import * as boards from "./boards";
import { HttpError, json, notFound } from "./http";
import { purge } from "./retention";
import type { Ctx, Env } from "./types";

type Handler = (c: Ctx, p: string[]) => Promise<Response>;

const ID = "([0-9a-f]{32})";
const routes: [string, RegExp, Handler][] = [
  ["POST", /^\/api\/register$/, (c) => account.register(c)],
  ["POST", /^\/api\/identity\/rotate$/, (c) => account.rotate(c)],
  ["POST", /^\/api\/sync$/, (c) => account.sync(c)],
  ["POST", /^\/api\/login-link$/, (c) => account.createLoginLink(c)],
  ["POST", /^\/api\/login-link\/inspect$/, (c) => account.inspectLoginLink(c)],
  ["POST", /^\/api\/login-link\/consume$/, (c) => account.consumeLoginLink(c)],
  ["POST", /^\/api\/logout$/, (c) => account.logout(c)],
  ["GET", /^\/api\/me$/, (c) => account.me(c)],
  ["PATCH", /^\/api\/me$/, (c) => account.updateMe(c)],
  ["POST", /^\/api\/me\/delete$/, (c) => account.deleteMe(c)],
  ["POST", /^\/api\/boards$/, (c) => boards.createBoard(c)],
  ["POST", /^\/api\/join\/preview$/, (c) => boards.previewJoin(c)],
  ["POST", /^\/api\/join$/, (c) => boards.join(c)],
  ["GET", new RegExp(`^/api/boards/${ID}$`), (c, p) => boards.viewBoard(c, p[0]!)],
  ["PATCH", new RegExp(`^/api/boards/${ID}$`), (c, p) => boards.updateBoard(c, p[0]!)],
  ["POST", new RegExp(`^/api/boards/${ID}/invite/regenerate$`), (c, p) => boards.regenerateInvite(c, p[0]!)],
  ["POST", new RegExp(`^/api/boards/${ID}/leave$`), (c, p) => boards.leave(c, p[0]!)],
  ["POST", new RegExp(`^/api/boards/${ID}/delete$`), (c, p) => boards.deleteBoard(c, p[0]!)],
  ["POST", new RegExp(`^/api/boards/${ID}/members/${ID}/role$`), (c, p) => boards.setRole(c, p[0]!, p[1]!)],
  ["DELETE", new RegExp(`^/api/boards/${ID}/members/${ID}$`), (c, p) => boards.kick(c, p[0]!, p[1]!)],
];

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const c: Ctx = { req, env, url, now: Date.now(), ip: req.headers.get("CF-Connecting-IP") ?? "unknown" };
  try {
    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname);
      if (m && req.method === method) return await handler(c, m.slice(1));
    }
    throw notFound();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
    // Never log request data: only the error itself.
    console.error("unhandled", e instanceof Error ? e.message : "unknown");
    return json({ error: "internal" }, 500);
  }
}

export default {
  fetch: handle,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purge(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
