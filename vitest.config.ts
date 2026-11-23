import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            INVITE_HMAC_KEY: "test-only-hmac-key-not-a-real-secret",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: { setupFiles: ["./tests/worker/setup.ts"], include: ["tests/worker/**/*.test.ts"] },
  };
});
