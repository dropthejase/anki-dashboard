# Anki Leaderboard

A private, invite-only leaderboard for Anki. Create a board, share an invite link with your study group, and see how many cards each person reviewed today and over the last seven days.

An add-on in Anki Desktop reads your daily review count and sends it to a small Cloudflare backend. There are no passwords, no email and no AnkiWeb credentials: the add-on is your identity.

Status: version 1. It is deployed on Cloudflare's free plan and runs in Anki Desktop. You host your own copy, so you stay in control of the data.

## How it works

1. Install the add-on in Anki Desktop and sync once.
2. Choose Tools, then Open Leaderboard. Your browser opens already signed in.
3. Create a board or open a friend's invite link.
4. Each time Anki Desktop finishes a sync, your count for today is updated.

Phone-only reviews count only if the phone and then Anki Desktop are synced on the same day, because phones cannot run add-ons.

## Documentation

- [Install and self-host](docs/INSTALL.md): run locally, deploy to your own Cloudflare account, install the add-on.
- [Architecture](docs/ARCHITECTURE.md): how it works, and what is still unverified.
- [Releasing](docs/RELEASING.md): how add-on and website releases are made.
- [Decision records](docs/adr/): identity, invite links, review counts, the admin model, recovery codes and per-computer keys.
- [Threat model](docs/threat-model.md)

## What is in this repository

| Folder | Contents |
|---|---|
| `addon/` | The Anki Desktop add-on (Python) |
| `src/` | The Cloudflare Worker API (TypeScript) |
| `web/` | The React and Tailwind dashboard |
| `migrations/` | D1 (SQLite) schema |
| `tests/` | `worker`, `web`, `addon` and `e2e` test suites |
| `docs/` | Architecture, decisions, threat model, install and release guides |

Built with a Cloudflare Worker and D1, React 19, Vite and Tailwind 4. Tests use Vitest, pytest and Playwright.

## Security

Authentication, invites and roles are described in the [threat model](docs/threat-model.md), including the risks that are accepted for now. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
