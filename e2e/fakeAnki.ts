import type { APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

/**
 * Stands in for the Anki add-on. It speaks the same HTTP API, so the browser journeys can be driven
 * without Anki. The real add-on's behaviour is covered by its own pytest suite.
 */
export class FakeAnki {
  readonly secret = randomBytes(32).toString("base64url");
  constructor(
    private request: APIRequestContext,
    readonly name: string,
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.secret}` };
  }

  async register() {
    // Each fake Anki registers from its own address, as separate people would, so the per-IP registration limit stays out of the way.
    const ip = `198.51.100.${(randomBytes(1)[0]! % 250) + 1}`;
    const r = await this.request.post("/api/register", { headers: { ...this.headers(), "CF-Connecting-IP": ip }, data: { display_name: this.name } });
    if (!r.ok()) throw new Error(`register failed: ${r.status()}`);
  }

  async sync(reviewCount: number) {
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = await this.request.post("/api/sync", {
      headers: this.headers(),
      data: { local_date: local, review_count: reviewCount },
    });
    if (!r.ok()) throw new Error(`sync failed: ${r.status()}`);
  }

  /** Equivalent of Tools → Open Leaderboard: returns the URL Anki would open in the browser. */
  async openLeaderboardUrl(): Promise<string> {
    const r = await this.request.post("/api/login-link", { headers: this.headers() });
    if (!r.ok()) throw new Error(`login-link failed: ${r.status()}`);
    const { token } = await r.json();
    return `/signin#${token}`;
  }
}
