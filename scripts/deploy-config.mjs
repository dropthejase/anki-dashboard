// Writes wrangler.deploy.jsonc: a copy of wrangler.jsonc with your own D1 database id filled in.
//
// The committed wrangler.jsonc keeps a placeholder id, so the repository never carries anything tied to one
// Cloudflare account. The generated file is git-ignored. The id is an identifier, not a credential (using the
// database still needs your Cloudflare login), but keeping it out of the repo keeps forks and history clean.
//
// Usage: D1_DATABASE_ID=<uuid> npm run deploy:config
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const id = process.env.D1_DATABASE_ID?.trim();
if (!id || !UUID.test(id)) {
  console.error("Set D1_DATABASE_ID to your D1 database id (a UUID). `wrangler d1 create anki-leaderboard` prints it.");
  process.exit(1);
}

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("wrangler.jsonc", root), "utf8");
if (!source.includes(PLACEHOLDER)) {
  console.error("wrangler.jsonc no longer contains the placeholder database id, so there is nothing to replace.");
  process.exit(1);
}
writeFileSync(new URL("wrangler.deploy.jsonc", root), source.replace(PLACEHOLDER, id));
console.log(`Wrote ${fileURLToPath(new URL("wrangler.deploy.jsonc", root))}`);
