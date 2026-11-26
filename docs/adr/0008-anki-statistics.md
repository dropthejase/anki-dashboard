# 8. Share a few of Anki's own statistics

Status: accepted. Date: 2026-11-26.

## Context

The leaderboard showed only a review count. People wanted a few more fun comparisons, and wanted them to match what Anki itself shows, not numbers we compute.

## Decision

- The add-on sends three statistics with each push, read from Anki's own statistics backend call over the whole collection: days studied in the last 30 days, and passed and failed review answers today and over 7 days (Anki's "true retention").
- Everything uses the whole collection, not a chosen deck, so it matches the review count (which already counts every deck) and needs no setting.
- Sharing is on for everyone. There is no setting to turn it off. The Join and home pages, the README and `SECURITY.md` say what is shared.
- The server range-checks the statistics and ignores the whole object if any part is invalid, so a glitch never blocks the review count.
- They are stored as columns on the `users` row that each push already updates, so they cost no extra rows written (see the cost section in `docs/ARCHITECTURE.md`).
- The board page gets a Stats tab: one horizontal bar chart with a dropdown to choose the statistic. Retention resting on fewer than 20 answers is drawn fainter.

## Average retrievability

It was in the first release (1.1.0) and removed in 1.1.1. Anki only has it with FSRS, so anyone on the old scheduler would always show a dash. It is also reported as a percentage, which 1.1.0 mishandled. The database column was dropped (migration 0006). A server that still receives a `retrievability` field from add-on 1.1.0 ignores it.

## Consequences

- The add-on needs a new version (1.1.0). Members on 1.0.0 keep working and show a dash.
- The statistics come from a private Anki interface (`col._backend.graphs`). If it changes, the add-on sends no statistics instead of failing.
- Like counts, statistics come from the client and can be faked within their limits. That risk is accepted (threat T2).
- They update only when a push happens, which is when the count changes or the user asks.
