# Install and self-host

This guide covers running the project on your own machine, deploying it to your own Cloudflare account, and installing the Anki add-on. Everything runs on Cloudflare's free plan at small scale.

Status: the local steps are tested. The command-line deployment (Option A) has been run end to end on a live account. The dashboard route (Option B) has not, and dashboard labels change, so check the linked Cloudflare docs if a screen looks different.

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

You create two things on your Cloudflare account: a Worker, which runs the API and serves the website, and a D1 database, which stores the data.

Three pieces of information are involved. Only the first two are secret, and none of them should ever be committed to the repository:

- **Your Cloudflare login.** `wrangler login` stores it on your machine, outside the project. In CI or Workers Builds Cloudflare holds it for you.
- **The invite key.** A random password the server uses to sign invite links. You generate it once and give it to Cloudflare as a secret. It must be at least 32 characters, and the server refuses to run invites with a shorter one. Rotating it later invalidates every existing invite link.
- **Your database id.** This is only an identifier, not a password: using the database still needs your Cloudflare login. The repository keeps a placeholder, and a small script writes your real id into a git-ignored file, `wrangler.deploy.jsonc`, so nothing tied to your account is ever committed.

Generate the invite key with this command, which prints it without saving it anywhere:

```bash
openssl rand -base64 32
```

Do not reuse the `local-dev-key-not-for-production-use` value from `npm run dev` anywhere public.

### Option A: from the command line

```bash
npm install
npx wrangler login
npx wrangler d1 create anki-leaderboard
```

The last command prints a `database_id`. Use it as `D1_DATABASE_ID` below. Generate the config file once, then store the invite key as a secret, piped straight in so it is never shown or saved:

```bash
export D1_DATABASE_ID=<the id it printed>
npm run deploy:config
openssl rand -base64 32 | npx wrangler secret put INVITE_HMAC_KEY -c wrangler.deploy.jsonc
```

Deploy with one command. It builds the site, applies the database migrations to your remote database and deploys the Worker:

```bash
npm run deploy
```

Wrangler prints your URL, which looks like `https://anki-leaderboard.<your-subdomain>.workers.dev`. To update later, pull the new code and run `npm run deploy` again. Applying migrations again is safe, because D1 only runs the ones it has not seen.

### Option B: mostly from the Cloudflare dashboard

You can do most of this without a terminal, and the deployment is rebuilt from your GitHub fork every time you push.

1. Fork this repository on GitHub.
2. In the Cloudflare dashboard, go to Storage and databases, then D1, and create a database named `anki-leaderboard`. Copy its database id.
3. Go to Workers and Pages, choose to import a repository, and connect your fork. This uses [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). For an existing Worker the connect button is under Settings, then Builds.
4. In the build settings, add a build variable named `D1_DATABASE_ID` with your database id.
5. Set the build command to `npm ci` and the deploy command to `npm run deploy`. That builds the site, writes the config from your variable, applies the migrations and deploys.
6. Open the Worker, go to Settings, then Variables and Secrets, and add a secret named `INVITE_HMAC_KEY` with your generated key. Choose the runtime secret type, not a build-only variable, because build variables are not available when the app runs.

If the deploy step fails with a permissions error on the migration, open the D1 database in the dashboard, go to its Console, paste in the contents of `migrations/0001_init.sql`, and change the deploy command to `npm run build:web && npm run deploy:config && npx wrangler deploy -c wrangler.deploy.jsonc`.

Whether Workers Builds passes a build variable through to the deploy command has not been confirmed. If `D1_DATABASE_ID` is not found, put the id in your fork's copy of `wrangler.jsonc` instead. It is not a password, but then keep that fork private.

### Automatic deploys from GitHub (optional)

The repository's workflow in `.github/workflows/ci.yml` runs the tests on every push, and then deploys when the push is to `main` and every check passed. It needs three repository secrets (Settings, Secrets and variables, Actions):

- `CLOUDFLARE_API_TOKEN`: create it in the Cloudflare dashboard under My Profile, API Tokens, using the "Edit Cloudflare Workers" template and adding the permission Account, D1, Edit. Limit it to your own account.
- `CLOUDFLARE_ACCOUNT_ID`: shown in the dashboard sidebar and printed by `npx wrangler whoami`.
- `D1_DATABASE_ID`: your database id from `wrangler d1 create`.

Set the token without putting it in your shell history by running `gh secret set CLOUDFLARE_API_TOKEN`, which prompts for the value. The invite key stays on Cloudflare as a Worker secret and is not needed in GitHub.

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
