# ADR 0001: Identity and Authentication

- Status: Proposed
- Date: 2026-10-24
- Deciders: Project owner

## Context

The product is a private, invite-only Anki leaderboard. Users create or join multiple boards, admins can invite and kick members, and review counts are pushed from an Anki Desktop add-on. Constraints: operating cost of £0, no technical knowledge required from users, no AnkiWeb credentials or long-lived secrets stored by the service, and a small expected audience (hundreds to low thousands of users).

The data source is the local `revlog` read by a desktop add-on, so every contributing user already installs the add-on. Mobile apps cannot run add-ons, so data capture and website sign-in on a new browser both require Anki Desktop. This is an accepted limitation.

## Options considered

1. **Google sign-in.** Best reach, and Google holds the credentials. Requires brand verification with a domain, privacy policy and homepage on a domain the owner controls. The project owner reports that brand verification does not accept a `pages.dev` address. `pages.dev` and `workers.dev` are both on the Public Suffix List, so each subdomain is its own top private domain, but verification was still rejected. Testing mode is capped at 100 manually listed test users, which is unworkable. Requires a purchased domain (about £10 per year).
2. **Discord, GitHub or Microsoft sign-in.** Free and no domain required, but each excludes a large share of the target audience. Rejected on user reach.
3. **Amazon Cognito (hosted pool, Amplify UI).** Free tier reported as 10,000 monthly active users by the sources found (not verified against the account). Passwordless email codes and passkeys need the Essentials tier. Google federation through Cognito still needs a Google OAuth client and the same verification. Adds a second vendor, billing exposure (no hard spending cap) and email sender and deliverability setup.
4. **Supabase Auth, with or without Cloudflare.** Free tier reported as 50,000 monthly active users, but free projects pause after 7 days of inactivity and Supabase cannot serve a website. Mixed with Cloudflare it creates two vendors and two databases.
5. **Cloudflare-native email codes.** Cloudflare Email Service (public beta) requires Workers Paid (about $5 per month) to send to arbitrary recipients. Cloudflare Access one-time PIN is free for up to 50 users but is an allowlist product, not open sign-up. Neither is free and open.
6. **Username and password (self-managed or Cognito-managed).** Rejected: password liability, and no recovery without email.
7. **Federating from AnkiWeb credentials.** Rejected. AnkiWeb has no sign-in API. Proving identity would require the add-on to send a sync key or password to the service, which breaks the requirement to never handle AnkiWeb credentials.
8. **Add-on as identity provider.** Chosen, see below.

## Decision

The add-on is the identity provider. There is no third-party sign-in, no email, no password and no domain requirement.

- On the first sync that finishes, if the collection config holds no leaderboard secret, the add-on creates a random 256-bit secret and writes it to the collection config. It never creates a secret before a sync has finished, so a newly installed second machine adopts the existing secret.
- The collection config syncs through AnkiWeb, so the same AnkiWeb account yields the same identity on every machine. One AnkiWeb account maps to one leaderboard identity.
- The server stores only a hash of the secret.
- Each sync request carries the secret over HTTPS. The server hashes it to find the user.
- Website sign-in starts in the add-on (Tools, Open Leaderboard). The add-on asks the server for a one-time sign-in link containing 128 random bits, valid for about two minutes and single use. The browser opens it and receives an `HttpOnly` session cookie. A QR code of the same link covers phone sign-in.
- Roles (`admin` or `member`) are stored per board membership. Authorisation is checked server-side on every board request.
- Recovery is AnkiWeb's own account recovery followed by a sync, which restores the secret to the collection.

## Consequences

Positive:

- £0 cost, a single vendor (Cloudflare) and no domain requirement.
- No credentials of any kind held by the service, and no password or email handling.
- Smallest attack surface of the options considered. Random 128-bit and 256-bit values are not brute-forceable.

Negative and accepted:

- Signing in on a new browser requires opening Anki Desktop.
- The secret is stored in the collection, so AnkiWeb and anyone holding a copy of the collection or a full backup holds it. The identity is low-stakes, so this is accepted.
- A user with two AnkiWeb accounts appears as two identities. No merging in v1.
- Counts are client-reported and spoofable. Mitigated by sanity caps and rate limits.
- No account recovery beyond AnkiWeb recovery. If collection config does not sync, fall back to a one-time recovery code.

## Assumptions to verify

- Collection config (`mw.col.conf`) syncs through AnkiWeb and is writable by add-ons. Forum guidance supports this, but the official reference has not been read. To be confirmed when the add-on is built.
- The expected sync hook and thread-safety behaviour for reading the `revlog`.
- Cognito, Supabase and Cloudflare pricing and limits cited above come from third-party summaries and search results and should be re-checked if those options are revisited.

## Future options

Google or other sign-in could be added later as an optional login or recovery method, if a domain is bought. This ADR does not preclude it.
