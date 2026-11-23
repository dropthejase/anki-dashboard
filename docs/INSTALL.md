# Install and self-host

This guide covers running the project on your own machine, deploying it to your own Cloudflare account, and installing the Anki add-on. Everything runs on Cloudflare's free plan at small scale.

Status: the local steps are tested. The Cloudflare deployment steps have not yet been run end to end on a live account, and dashboard labels change, so treat them as a guide and check the linked Cloudflare docs if a screen looks different.

## What you need

- Node.js and npm. The project is developed on Node 26.
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up) for deployment (not needed to run locally).
- Anki Desktop, to run the add-on.
- Python 3.10 or newer only if you want to run the add-on tests.

## Run it locally

```bash
npm install
npm run dev
```

The app is at http://localhost:8787. It runs on a local copy of the database, stored in `.wrangler/state/` (git-ignored). Delete that folder to reset your data.

There is no password, so to sign in without Anki run `npm run dev:login -- "Your Name" 120` in a second terminal. It prints a sign-in link that works for two minutes.

Run all tests with `npm run test:all`, and the browser journeys with `npm run e2e`. See `CLAUDE.md` for the full command list.

## Deploy to your own Cloudflare account

You deploy two things: a Worker that serves the API and the website, and a D1 database. Two secrets of your own are involved: one random key for signing invite links, and your Cloudflare login. Neither belongs in the repository.

Generate the invite key once and keep it somewhere safe. It must be at least 32 characters, and the server refuses to run invites with a shorter one. Rotating it later invalidates every existing invite link.

```bash
openssl rand -base64 32
```

Do not reuse the `local-dev-key-change-me` value from `npm run dev` anywhere public.

### Option A: from the command line

```bash
npm install
npx wrangler login
npx wrangler d1 create anki-leaderboard
```

Copy the `database_id` it prints into `wrangler.jsonc`. The id is not a secret, but it belongs to your account, so keep your edited copy to yourself or commit it to your own fork only.

```bash
npx wrangler d1 migrations apply anki-leaderboard --remote
npx wrangler secret put INVITE_HMAC_KEY
npm run build:web
npx wrangler deploy
```

Wrangler prints your URL, which looks like `https://anki-leaderboard.<your-subdomain>.workers.dev`.

To update later, pull the new code and repeat the last three commands. Applying migrations again is safe, because D1 only runs the ones it has not seen.

### Option B: mostly from the Cloudflare dashboard

You can do most of this without a terminal. The deployment is rebuilt from your GitHub fork every time you push.

1. Fork this repository on GitHub.
2. In the Cloudflare dashboard, go to Storage and databases, then D1, and create a database named `anki-leaderboard`. Copy its database id.
3. In your fork, edit `wrangler.jsonc` (GitHub's web editor is fine) and replace the placeholder `database_id` with yours.
4. Go to Workers and Pages, choose to import a repository, and connect your fork. This uses [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). For an existing Worker the connect button is under Settings, then Builds.
5. Set the build command to `npm ci && npm run build:web`.
6. Set the deploy command to `npx wrangler d1 migrations apply anki-leaderboard --remote && npx wrangler deploy`. Migrations are not applied by `wrangler deploy` on its own, so they belong in this command.
7. Open the Worker, go to Settings, then Variables and Secrets, and add a secret named `INVITE_HMAC_KEY` with your generated key. Choose the runtime secret type, not a build-only variable, because the build variables are not available when the app runs.

If the migration step fails with a permissions error, open the D1 database in the dashboard, go to its Console, and paste in the contents of `migrations/0001_init.sql` instead.

The one step that cannot be done in a screen is generating the random key, so do that with the command above or any password generator that produces 32 random bytes.

### Check it works

Open your URL. You should see the "Open the leaderboard from Anki" page. Then install the add-on, as below, and sync Anki.

Things worth knowing before you share it with others:

- Free-plan limits are a hard stop, not a bill. See `docs/PRD.md` section 12 and re-check Cloudflare's current limits.
- A daily cleanup job (one cron trigger) removes inactive accounts. Cloudflare lists 5 cron triggers per account on the free plan, but this is not yet confirmed on a live account, and D1 backup options are not yet verified (`docs/PRD.md` section 14).
- Do not move to a paid Workers plan without setting up usage alerts, because overage is billed.

## Install the Anki add-on

Build the package:

```bash
npm run package:addon
```

This writes `dist/anki_leaderboard.ankiaddon`. In Anki Desktop choose Tools, then Add-ons, then Install from file, and pick that file. Restart Anki.

Next point the add-on at your server. In Tools, Add-ons, select Anki Leaderboard, choose Config, and set `server_url` to your Worker address, for example `https://anki-leaderboard.<your-subdomain>.workers.dev`. For local testing use `http://localhost:8787`. Plain http is only accepted for localhost.

Then sync Anki once. The first finished sync creates your identity. After that choose Tools, then Open Leaderboard, and your browser opens already signed in.

The add-on only reads the number of cards you reviewed today. It never sends your cards, decks or AnkiWeb login. See `docs/adr/0001-identity-and-authentication.md` and `docs/threat-model.md` for how identity works and what is accepted as a risk.

## Using more than one computer

The identity secret is stored in your collection and is meant to travel with it through AnkiWeb sync, so two computers on one AnkiWeb account should be the same person. This has not yet been verified with two real Anki installs (`docs/PRD.md` section 14). If you try it, sync on the first computer before installing the add-on on the second.
