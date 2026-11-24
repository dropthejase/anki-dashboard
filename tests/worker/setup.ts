import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// D1 state is shared between tests in a file, so start every test from empty tables.
beforeEach(async () => {
  await env.DB.batch(
    ["board_images", "memberships", "boards", "daily_stats", "sessions", "login_links", "link_codes", "devices", "rate_limits", "users"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});
