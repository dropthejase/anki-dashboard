# ADR 0002: Invite links are derived with an HMAC

- Status: Accepted
- Date: 2026-11-23
- Deciders: Project owner

## Context

Boards are private and invite-only. Members and admins must be able to share a link or QR code, admins must be able to switch the link off or replace it, and strangers must not be able to find or guess boards. The service should not hold a database of plaintext join tokens.

## Options considered

1. **Random token stored per board.** Simple, but plaintext tokens in the database leak with any database read, and rotating means storing the new value.
2. **Signed link with an expiry.** Limits how long a leaked link works, but links must then be reissued constantly and members could not simply copy a standing link.
3. **HMAC derived from the board id and an epoch counter.** Chosen.

## Decision

The invite token is `HMAC-SHA256(INVITE_HMAC_KEY, boardId + ":" + inviteEpoch)`, computed when needed and never stored. The link is `/join#<boardId>.<token>`, with the token in the URL fragment so it is not sent to a server or a Referer header.

- Regenerating a link increments `invite_epoch`, which invalidates every older link at once.
- Admins can switch the link off. While it is off nobody can join with it, and members no longer see it.
- A wrong board id, a wrong token and a disabled link all return the same 404, so a guesser learns nothing.
- Tokens are compared in constant time. Board ids are random 128-bit values, never sequential.
- The key is a Worker secret, never in D1 or the repository, and must be at least 32 characters. The server refuses to sign or verify with anything shorter.
- Joins are rate limited per user and per IP, and a board can set an optional member cap that is enforced inside the insert.

## Consequences

Positive:

- No plaintext join tokens at rest.
- One counter bump revokes every old link, and the same link can be re-enabled later.

Negative and accepted:

- Anyone who holds a valid link can join until an admin switches it off or regenerates it. Links do not expire on their own and cannot be revoked for one person only.
- Rotating `INVITE_HMAC_KEY` invalidates every link on every board. Members re-copy the new link from the board page.
- A leaked key plus a board id would let someone forge that board's link, which is why board ids are random and the key is kept out of the database and the repository.
