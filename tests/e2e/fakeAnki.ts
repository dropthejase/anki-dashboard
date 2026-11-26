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

  /** Equivalent of Settings > Show a code for my other computer, on a computer that is already set up. */
  async linkCode(): Promise<string> {
    const r = await this.request.post("/api/link-code", { headers: this.headers() });
    if (!r.ok()) throw new Error(`link-code failed: ${r.status()}`);
    return (await r.json()).code;
  }

  /** Equivalent of answering "Yes, enter the code from my other computer" and typing the code. */
  async linkWith(code: string, label = "Second computer"): Promise<void> {
    const r = await this.request.post("/api/link", {
      headers: { "CF-Connecting-IP": `198.51.100.${(randomBytes(1)[0]! % 250) + 1}` },
      data: { link_code: code, new_secret: this.secret, device_label: label },
    });
    if (!r.ok()) throw new Error(`link failed: ${r.status()}`);
  }

  /** Equivalent of Settings > Restore with a recovery code: trades a recovery code for this client's (new) secret. */
  async recoverWith(code: string): Promise<{ recovery_code: string }> {
    const r = await this.request.post("/api/recover", {
      headers: { "CF-Connecting-IP": `198.51.100.${(randomBytes(1)[0]! % 250) + 1}` },
      data: { recovery_code: code, new_secret: this.secret },
    });
    if (!r.ok()) throw new Error(`recover failed: ${r.status()}`);
    return r.json();
  }

  async sync(reviewCount: number, stats?: Record<string, unknown>) {
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = await this.request.post("/api/sync", {
      headers: this.headers(),
      data: { local_date: local, review_count: reviewCount, ...(stats ? { stats } : {}) },
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
