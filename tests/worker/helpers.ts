import { env, exports } from "cloudflare:workers";

const worker = (exports as unknown as { default: { fetch(r: Request): Promise<Response> } }).default;

export const ORIGIN = "https://leaderboard.test";

/** Sends a hand-built request straight to the Worker, for cases `call` cannot express (such as streamed bodies). */
export const rawFetch = (r: Request) => worker.fetch(r);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

interface CallOpts {
  body?: unknown;
  secret?: string;
  cookie?: string;
  origin?: string | null;
  ip?: string;
}

export async function call(method: string, path: string, o: CallOpts = {}) {
  const headers: Record<string, string> = { "CF-Connecting-IP": o.ip ?? "203.0.113.1" };
  if (o.secret) headers.Authorization = `Bearer ${o.secret}`;
  if (o.cookie) headers.Cookie = o.cookie;
  const origin = o.origin === undefined ? (o.cookie ? ORIGIN : null) : o.origin;
  if (origin) headers.Origin = origin;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(
    new Request(ORIGIN + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }),
  );
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

export interface TestUser {
  id: string;
  name: string;
  secret: string;
  cookie: string;
}

let ipCounter = 0;

/** Registers an identity and signs it in through the real login-link flow. */
export async function makeUser(name = "Alice"): Promise<TestUser> {
  const secret = newSecret();
  const ip = `198.51.100.${(ipCounter++ % 250) + 1}`; // spread across IPs to stay under the registration limit
  const reg = await call("POST", "/api/register", { secret, body: { display_name: name }, ip });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.data)}`);
  const link = await call("POST", "/api/login-link", { secret });
  const consume = await call("POST", "/api/login-link/consume", { body: { token: link.data.token }, origin: ORIGIN });
  const cookie = consume.headers.get("Set-Cookie")!.split(";")[0]!;
  return { id: reg.data.user_id, name, secret, cookie };
}

export async function makeBoard(owner: TestUser, name = "Study group") {
  const r = await call("POST", "/api/boards", { cookie: owner.cookie, body: { name } });
  const view = await call("GET", `/api/boards/${r.data.id}`, { cookie: owner.cookie });
  const [boardId, token] = view.data.join_path.replace("/join#", "").split(".");
  return { id: boardId as string, token: token as string, joinBody: { board_id: boardId, token } };
}

export async function joinBoard(user: TestUser, board: { joinBody: unknown }) {
  return call("POST", "/api/join", { cookie: user.cookie, body: board.joinBody });
}

export const db = () => env.DB;

export const today = () => new Date().toISOString().slice(0, 10);

/** Bypasses the 30-minute push interval for tests that push several times. */
export async function pushStats(user: TestUser, count: number, date = today()) {
  await db().prepare("UPDATE users SET last_push_at = NULL WHERE id = ?").bind(user.id).run();
  return call("POST", "/api/sync", { secret: user.secret, body: { local_date: date, review_count: count } });
}
