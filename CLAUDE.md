# Anki Leaderboard

Read `docs/` before making any design or code decision.

- `docs/PRD.md` is the product requirements (Draft v2).
- `docs/threat-model.md` is the threat model (Shostack's four questions). Update it when authentication, invites or roles change.
- `docs/adr/` holds architecture decisions. Start with `0001-identity-and-authentication.md`. Where an ADR and the PRD conflict, the ADR wins.

## Git

This is a small project: branch off `main` with `feature/<name>` branches. Do not merge to `main` without explicit approval.

## Commands

- `npm run test:all`: typecheck, Worker tests (real local D1), web component tests and add-on tests.
- `npm run e2e`: Playwright journeys against a local `wrangler dev`. A fake Anki client (`e2e/fakeAnki.ts`) stands in for the add-on.
- `npm run dev`: local server at http://localhost:8787.
- `npm run package:addon`: builds `anki_leaderboard.ankiaddon`.
- `LEADERBOARD_URL=http://localhost:8787 .venv/bin/python -m pytest`: also runs the add-on-to-Worker contract test (needs `npm run dev` running; create `.venv` with `python3 -m venv .venv && .venv/bin/pip install pytest`).
