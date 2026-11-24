import { sha256Hex } from "./crypto";
import { HttpError } from "./http";
import type { Ctx } from "./types";

/**
 * Fixed-window limiter in D1. The key is a hash of (name, subject), so IP addresses are never stored.
 * Throws a 429 once `limit` hits have been made inside `windowSec`.
 */
export async function rateLimit(
  c: Ctx,
  name: string,
  subject: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  const key = await sha256Hex(`${name}:${subject}`);
  const windowMs = windowSec * 1000;
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING count, window_start`,
  )
    .bind(key, c.now, windowMs)
    .first<{ count: number; window_start: number }>();
  if (row && row.count > limit) {
    const retry = Math.max(1, Math.ceil((row.window_start + windowMs - c.now) / 1000));
    throw new HttpError(429, "rate_limited", { retry_after_seconds: retry });
  }
}
