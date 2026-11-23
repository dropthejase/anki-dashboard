# Anki Leaderboard

A private, invite-only leaderboard for Anki. Create a board, share an invite link with your study group, and see how many cards each person reviewed today and over the last seven days.

An add-on in Anki Desktop reads your daily review count and sends it to a small Cloudflare backend. There are no passwords, no email and no AnkiWeb credentials: the add-on is your identity.

Status: pre-release. It runs locally and the test suites pass. It has not yet been deployed or published.

## How it works

1. Install the add-on in Anki Desktop and sync once.
2. Choose Tools, then Open Leaderboard. Your browser opens already signed in.
3. Create a board or open a friend's invite link.
4. Each time Anki Desktop finishes a sync, your count for today is updated.

Phone-only reviews count only if the phone and then Anki Desktop are synced on the same day, because phones cannot run add-ons.

## Documentation

- [Install and self-host](docs/INSTALL.md): run locally, deploy to your own Cloudflare account, install the add-on.
- [Product requirements](docs/PRD.md)
- [Identity and authentication decision](docs/adr/0001-identity-and-authentication.md)
- [Threat model](docs/threat-model.md)

## What is in this repository

| Folder | Contents |
|---|---|
| `addon/` | The Anki Desktop add-on (Python) |
| `src/` | The Cloudflare Worker API (TypeScript) |
| `web/` | The React and Tailwind dashboard |
| `migrations/` | D1 (SQLite) schema |
| `test/`, `web/tests/`, `tests_addon/`, `e2e/` | Worker, component, add-on and Playwright tests |
| `docs/` | Requirements, decisions, threat model and install guide |

Built with a Cloudflare Worker and D1, React 19, Vite and Tailwind 4. Tests use Vitest, pytest and Playwright.

## Security

Authentication, invites and roles are described in the [threat model](docs/threat-model.md), including the risks that are accepted for now. A security reporting policy has not been added yet.
