# Anki Leaderboard: Product Requirements

Status: Draft v2. Supersedes the original prompt-style draft. Identity and authentication are specified in `docs/adr/0001-identity-and-authentication.md`; where this document and an ADR conflict, the ADR wins.

## 1. Overview

A private, invite-only Anki leaderboard. People build or join multiple boards and see how many cards each member has reviewed today and over the last seven days. Review counts are read locally by a small Anki Desktop add-on and pushed to a Cloudflare backend. A web dashboard shows the boards.

## 2. Goals and non-goals

Goals:

- Operating cost of £0 at expected load (hundreds to low thousands of users), on Cloudflare free tiers.
- Zero technical effort for users: no tokens to copy, no config files, no passwords, no email.
- Private boards that cannot be brute-forced into, with admin control over membership.
- No AnkiWeb credentials, scraping or long-lived user secrets handled by the service.

Non-goals (v1):

- In-Anki leaderboard UI. The add-on has menu items and a plain status message only.
- Ban list, join-approval queue, third-party login (Google etc.), email, account merging.
- Capturing reviews from devices that cannot run the add-on (see section 11).

## 3. User stories

- As a user with Anki on desktop and mobile, when I hit Sync and Anki Desktop syncs, the cards I reviewed today reach my boards.
- As a user, I can build a board, and join any number of other boards by invite link or QR code.
- As an admin, I can disable or regenerate the invite link, kick members and promote co-admins.
- As a member, I can copy and share the invite link, subject to the admin's controls.
- As a user with two laptops on the same AnkiWeb account, I am the same person on both with no extra setup.

## 4. Architecture

- Anki Desktop add-on (Python 3), small by design to limit exposure to Anki version changes.
- Cloudflare Worker serving the API and the static React and Tailwind front end (shadcn/ui components), with Cloudflare D1 (SQLite) for data.
- No other vendors. Workers run on V8, not Node.js.

Data flow: the add-on counts today's reviews from the local `revlog`, and pushes the count to the Worker over HTTPS. The Worker stores one daily row per user. Boards read from those rows, so one push serves every board a user belongs to.

## 5. Identity and sign-in (summary of ADR 0001)

- First finished sync: if the collection config holds no leaderboard secret, the add-on creates a random 256-bit secret and stores it there. It never creates one before a sync has finished.
- AnkiWeb syncs the collection config, so one AnkiWeb account yields one identity across laptops. Recovery is AnkiWeb's own recovery followed by a sync.
- The server stores only a hash of the secret. Requests carry the secret over HTTPS.
- Website sign-in: Tools, Open Leaderboard. The add-on requests a one-time link (128 random bits, valid about two minutes, single use). The browser opens it and receives an `HttpOnly`, `Secure`, `SameSite` session cookie. A QR code of the same link signs in a phone.
- Signing in on a new browser needs Anki open on a computer. Accepted limitation.
- Session lifetime: 30 days, extended on use, with a 90-day absolute maximum (proposed).

## 6. Add-on requirements

- Tools menu items: Link Leaderboard (first-time identity and registration), Open Leaderboard, Sync Leaderboard Now, Reset Leaderboard Identity.
- Reset Leaderboard Identity rotates the secret: it writes a new secret to the collection config, registers it and revokes the old one.
- Sync triggers: the `sync_did_finish` event and the manual menu item. No scheduled timer.
- Count: the total number of reviews (answers) since the Anki day cutoff ("next day starts at"), which is what Anki's own "Today" statistic reports. Send it with the user's local date. The count must match the figure Anki itself reports, so manual scheduling changes (set due date, forget, reposition) are excluded. Verified against Anki's source (`rslib/src/storage/revlog/studied_today.sql`): `SELECT COUNT() FROM revlog WHERE id > (day_cutoff - 86400) * 1000 AND type != 4 AND type != 5`, with the day cutoff from `col.sched.day_cutoff`. Still to compare against a real collection's "Today" figure by hand before launch.
- Send only if the count changed since the last successful push. The server also enforces a minimum interval of 5 minutes per user.
- The count query runs on the main thread (one fast query); the network call runs through `mw.taskman.run_in_background`, so the Anki UI does not freeze.
- Show a plain success or error message after a manual sync.
- Treat server responses as untrusted data: parse JSON only, validate fields, never evaluate or download code, and verify TLS certificates.

## 7. Data model (D1)

- `users`: `id`, `secret_hash`, `display_name`, `created_at`, `last_active_date`, `last_push_at` (for the 5-minute interval).
- `daily_stats`: `user_id`, `local_date`, `review_count`, `updated_at`. Primary key `(user_id, local_date)`. Upsert with `MAX(existing, excluded)` so incremental pushes on the same day are safe. The 7-day total is computed from these rows.
- `boards`: `id` (random 128-bit, never sequential), `name`, `invite_enabled`, `invite_epoch`, `member_cap` (nullable, no default), `created_at`.
- `memberships`: `board_id`, `user_id`, `role` (`admin` or `member`), `joined_at`. Primary key `(board_id, user_id)`, with an index on `user_id`.
- `login_links`: hash of the one-time link, `user_id`, `expires_at`, `used_at`.
- `sessions`: hash of the session ID, `user_id`, `created_at`, `expires_at`.
- `rate_limits`: fixed-window counters keyed by a hash of the limit name and subject (IP addresses are not stored). Each limited request costs one D1 write.

All stored tokens (device secret, login links, sessions) are stored as hashes. Avoid per-request writes such as updating "last seen" on every call; update `last_active_date` at most once a day and session expiry at most once an hour.

## 8. Boards and invites

- Creating a board makes the creator admin. A board may have several admins. A board must never have members but no admin: the last admin cannot leave, be demoted or be removed without promoting someone first (each is a single guarded statement, so concurrent requests cannot break it). A sole admin who is also the only member can leave, which deletes the board. If an account is deleted or purged, the longest-standing active member is promoted first. As a safety net the daily job promotes a member on any board found with members but no admin.
- The invite token is `HMAC(server_secret, board_id + invite_epoch)`, computed on demand, so plaintext tokens are never stored. Members can see and share it.
- Admin controls: enable or disable the link, regenerate it (increments `invite_epoch`, invalidating all old links), kick a member, promote or demote a member, optionally set a member cap, and delete the board. Deleting needs the exact board name typed as confirmation, removes the board and its memberships for everyone, and leaves accounts and review stats untouched. The invite is also available as a QR code.
- Opening a valid link while signed in joins the board immediately, up to the member cap if one is set. Rate-limit the join endpoint.
- Every board endpoint checks membership and role server-side. Non-members get a not-found style response that does not reveal the board exists.

## 9. Web dashboard

- Built with React, Tailwind and shadcn/ui components.
- Light and dark themes. Default to the system setting, with a manual toggle. Slate or zinc palette with an indigo or violet accent.
- Board leaderboard table showing today's count and the 7-day total per member, with podium badges for the top three, hover micro-interactions, skeleton loaders and a mobile-responsive layout.
- The board response returns the top N members (for example 100) plus the caller's own row, so query cost stays bounded for large boards.
- Each member row shows when their data was last updated and a "last updated from desktop" hint, because mobile reviews appear only after Desktop syncs.
- A Refresh button refetches the board, with a 5-second client-side cooldown. There is no server-side staleness window yet (a limiter would add a D1 write to every read); reads are bounded by authentication and the free tier. Revisit if read volume becomes a concern.
- My boards list, create board, board settings for admins, and a join confirmation page.
- Board responses are member-only: send `Cache-Control: private` or `no-store`. Never use shared or public edge caching for them.

## 10. Security requirements

- No AnkiWeb credentials, passwords or third-party tokens stored anywhere.
- All secrets, login links, invite tokens and session IDs come from a cryptographically secure random source and are at least 128 bits.
- Never log request bodies, secrets or tokens.
- Membership and role checks on every board endpoint, covered by automated tests, including attempts to read or modify boards the caller does not belong to.
- CSRF protection on cookie-authenticated, state-changing endpoints: `SameSite` cookies, non-GET methods only and an `Origin` check.
- XSS protection: no raw HTML rendering, a strict Content Security Policy, and length and character limits on display names.
- Registration and sync abuse: rate limits on registration, sync, login-link creation and join, per IP for registration. A proof-of-work step is NOT implemented; decision pending (see section 14). Delete identities with no activity after a set period.
- Sanity cap of 10,000 reviews per day to blunt spoofed counts. Counts are client-reported and cannot be fully verified.
- Data retention: delete identities that never synced or joined a board after 30 days, and identities with no sync or web sign-in for 12 months. A purge removes the user's stats and memberships, deletes boards left with no members, and promotes the longest-standing active member if an inactive admin leaves a board that still has active members. Run as a daily scheduled job. State the retention periods in the privacy policy.
- Display names are user-chosen and public to board members. Provide a way to delete an account and its data.

## 11. Known limitations

- Data capture is desktop-only. Mobile apps cannot run add-ons, so a phone-only day shows after Anki Desktop next syncs. Only today's count is pushed, so phone reviews reach the board only if the phone and then Anki Desktop sync within the same Anki day. Reviews synced to Desktop after the day cutoff are never pushed.
- Signing in on a new browser requires Anki Desktop.
- Counts are client-reported and spoofable.
- A person with two AnkiWeb accounts appears as two identities.
- Board admins are equals. There is no board owner, so any admin can demote or remove any other admin, including the creator, and any admin can delete the board. The last admin still cannot demote themselves or leave without promoting someone first. Accepted for v1.

## 12. Cost and limits

- Expected load is hundreds to low thousands of users with a few pushes a day each. This fits within Cloudflare Workers and D1 free tiers.
- Free-tier limits are a hard stop, not a bill. Abuse or growth could make the service fail rather than cost money.
- Do not move to Workers Paid without usage alerts, because overage there is billed and there is no hard cap. The fallback if growth requires it is about $5 per month.
- Re-check current Workers and D1 limits before launch.

## 13. Deliverables

1. Add-on: `__init__.py`, `manifest.json`, `config.json`, identity creation and rotation, sync hook, manual sync, link and open menu items.
2. D1 schema and migrations, and `wrangler.toml`.
3. Worker API: register, sync, login-link issue and consume, boards, invites, membership admin.
4. React, Tailwind and shadcn/ui dashboard.
5. Automated tests, per the testing strategy below.

### Testing strategy

Follow the testing pyramid: many fast unit tests, fewer integration tests, and the fewest end-to-end tests, which also run least often. Run the relevant suite whenever a change touches more than one file.

| Layer | What it covers | How often |
|---|---|---|
| Unit | Pure logic: token generation and hashing, HMAC invite tokens, login-link expiry and single use, role rules (last admin), the `MAX` upsert, the day-cutoff and count logic, input validation. | Every commit |
| Integration | Worker API against a real local D1: register, sync, login-link flow, board and membership endpoints, rate limits, CSRF and `Origin` checks, and the authorisation matrix. | Every pull request |
| End-to-end | A few critical journeys in a browser with Playwright: sign in via a login link, create a board, join through an invite link, admin kicks a member, light and dark theme. | Before merging to `main`, and on demand |

Priorities:

- Security tests come first: for every board endpoint, assert that a non-member, a member and an admin each get the correct result, and that a non-member cannot tell whether a board exists.
- Token tests: only hashes are stored, login links are single use and expire, regenerating the invite invalidates old links, and a rotated identity secret stops working.
- Keep the add-on testable by isolating the Anki-specific calls behind a thin adapter. Test the count query against an in-memory SQLite database with the `revlog` schema, and test sync, retry and dedupe logic with the adapter faked.
- Tooling (to confirm at build time): pytest for the add-on, and Vitest with Cloudflare's Workers test pool and React Testing Library for the Worker and front end. Playwright for end-to-end.
- CI: a simple job that runs the unit and integration suites on every push and pull request, to catch regressions. End-to-end tests run before merging to `main` and on demand. Expand the CI setup if the project becomes open source. The CI host depends on where the repository is hosted.

## 14. Open items

Assumptions to verify:

- Collection config (`mw.col.conf`) syncs through AnkiWeb and is writable by add-ons. If not, fall back to a one-time recovery code.
- Verified in Anki's source: `gui_hooks.sync_did_finish` exists (no arguments, fires after the collection sync), and `col.get_config` / `col.set_config` read and write the collection config. Not yet verified: that this config actually reaches a second machine through AnkiWeb sync (needs two real Anki installs).
- Cloudflare free-tier limits at build time.
- Decision pending: whether to drop the registration proof-of-work step (per-IP rate limiting is in place).
- Cron triggers: Cloudflare's [limits page](https://developers.cloudflare.com/workers/platform/limits) lists 5 per account on the free plan and we use 1. Not yet confirmed on a live account. D1 backup options, and AnkiWeb MFA and upload eligibility, are unverified.
- Local `wrangler dev` does not run the scheduled retention job automatically. It is tested directly, and can be triggered with `curl http://localhost:8787/cdn-cgi/local/scheduled`.
