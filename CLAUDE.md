# Anki Leaderboard

Read `docs/` before making any design or code decision.

- `docs/ARCHITECTURE.md` describes the system as built. Start here.
- `docs/PRD.md` is the original product requirements, kept as a historical reference.
- `docs/threat-model.md` is the threat model (Shostack's four questions). Update it when authentication, invites or roles change.
- `docs/adr/` holds architecture decisions. Start with `0001-identity-and-authentication.md`. Where an ADR and the PRD conflict, the ADR wins.

## Git

This is a small project: branch off `main` with `feature/<name>` branches. Do not merge to `main` without explicit approval.

## Commands

- `npm run test:all`: typecheck, Worker tests (real local D1), web component tests and add-on tests.
- `npm run e2e`: Playwright journeys against a local `wrangler dev`. A fake Anki client (`tests/e2e/fakeAnki.ts`) stands in for the add-on. Set `E2E_PORT=8788` to run beside a local `npm run dev` on 8787; run `npx playwright install chromium` once if the browser is missing.
- `npm run dev`: local server at http://localhost:8787. Then `npm run dev:login -- "Name" 120` prints a sign-in URL, standing in for Anki.
- `npm run package:addon`: builds `anki_leaderboard.ankiaddon`.
- `LEADERBOARD_URL=http://localhost:8787 .venv/bin/python -m pytest`: also runs the add-on-to-Worker contract test (needs `npm run dev` running; create `.venv` with `python3 -m venv .venv && .venv/bin/pip install pytest`).
