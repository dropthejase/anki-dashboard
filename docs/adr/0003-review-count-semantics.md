# ADR 0003: What is counted, and what is pushed

- Status: Accepted
- Date: 2026-11-23
- Deciders: Project owner

## Context

The leaderboard compares how much people studied. The number must agree with what Anki itself shows, must be cheap to send, and must not require sending a user's review history to a server.

## Options considered

1. **Unique cards reviewed.** Does not match Anki's "Today" figure.
2. **Every answer since midnight (UTC or local).** Wrong for people whose Anki day rolls over at a different hour ("next day starts at").
3. **Every answer since Anki's own day cutoff, excluding manual and rescheduled entries.** Chosen.

## Decision

- The add-on counts rows in the local review log since the day cutoff reported by Anki, excluding types 4 (manual) and 5 (rescheduled). This is the query Anki uses for its own "Today" statistic (`rslib/src/storage/revlog/studied_today.sql`).
- It pushes only today's count, tagged with the local date of the Anki day. History is never sent.
- The server upserts with `MAX(existing, new)`, so repeated pushes in one day are safe and a count can only go up.
- Pushes happen when Anki finishes a sync (`sync_did_finish`) or when the user asks, and only if the count changed. The server allows one push per user every five minutes and caps a day at 10,000.
- The server accepts dates within two days of its own UTC date, since local dates range from UTC-12 to UTC+14.

## Consequences

Positive:

- The number matches what the user sees in Anki.
- Only one small number per day leaves the machine, and the server holds no review history beyond those daily totals.

Negative and accepted:

- Because only today is pushed, phone reviews count only if the phone and then Anki Desktop sync within the same Anki day. Reviews that reach the desktop after the day rolls over are never sent.
- Counts are client-reported. They can be faked up to the cap.
- Verified against Anki's source, but not yet compared by hand against a real collection's "Today" figure.
