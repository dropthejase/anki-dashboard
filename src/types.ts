export interface Env {
  DB: D1Database;
  /** Worker secret. Never stored in D1 or the repo. Rotating it invalidates every invite link. */
  INVITE_HMAC_KEY: string;
  /** Newest add-on release, as x.y.z. Reported to add-ons in sync replies so they can tell users to update. Optional. */
  ADDON_LATEST_VERSION?: string;
}

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  now: number;
  /** Client IP, used only to derive hashed rate-limit keys. */
  ip: string;
}

export interface UserRow {
  id: string;
  secret_hash: string;
  display_name: string;
  created_at: number;
  last_active_date: string;
  last_push_at: number | null;
}

export type Role = "admin" | "member";
