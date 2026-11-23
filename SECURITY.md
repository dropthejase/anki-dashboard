# Security policy

This is a small, volunteer-run project. It handles sign-in and group membership, so security reports are taken seriously, but there is no paid support or guaranteed response time. Reports are handled on a best-effort basis.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: open the repository's Security tab and choose Report a vulnerability. Include what you found, how to reproduce it, and the impact you expect.

If the Report a vulnerability button is not shown, the maintainer has not enabled private reporting on that repository yet. In that case open a public issue that says only that you have a security report and ask for a private way to send it. Do not put details in the public issue.

## Scope

In scope:

- The Worker API in `src/` and the database schema in `migrations/`.
- The web app in `web/`.
- The Anki add-on in `addon/`.
- Authentication, invite links, session handling, and board membership and role checks.

Examples of what we want to hear about: reading or changing a board you do not belong to, acting as another user, forging or reusing a sign-in or invite link, a stored script that runs in another member's browser, the add-on running or downloading code from the server, or secrets showing up in logs or responses.

Out of scope:

- Risks already listed as accepted in `docs/threat-model.md`, such as review counts being client-reported and therefore fakeable within the daily cap, or the identity secret being visible to AnkiWeb and to other add-ons on your machine.
- Free-tier limits on your own Cloudflare account causing an outage.
- Findings that need a compromised device, browser or Anki profile.
- Automated scanner output with no demonstrated impact.

## Running your own copy

If you self-host this, you are responsible for your own deployment. Keep `INVITE_HMAC_KEY` secret and never reuse the local development key, keep Wrangler and your dependencies up to date, and review `docs/INSTALL.md` before sharing the address with others.

## Supported versions

The project is pre-release. Only the latest commit on the main branch receives fixes.
