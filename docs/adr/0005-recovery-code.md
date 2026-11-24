# ADR 0005: A recovery code restores a lost identity

- Status: Accepted
- Date: 2026-11-24
- Deciders: Project owner

## Context

An identity is a random secret stored in the user's Anki collection (ADR 0001). If that secret is lost, for example through a full sync that overwrites the collection settings, a lost backup or a reinstall, the server cannot help: it holds only a hash, and nobody can sign in without the secret. The old account, its boards and its admin roles become unreachable. ADR 0001 named a recovery code as the fallback.

## Options considered

1. **Show the secret itself as the recovery code.** The server cannot, because it stores only a hash. The add-on could, but then the credential is on screen and in screenshots.
2. **Email or a third-party login.** Rejected in ADR 0001.
3. **A separate recovery code, made while signed in, that attaches a new secret to the old account.** Chosen.

## Decision

- A signed-in user can make a recovery code on the Account page. It is 160 random bits, written as 32 letters and digits in groups of four. It is shown once, and only its SHA-256 hash is stored. Making a new code replaces and cancels the old one.
- In Anki, Tools, Leaderboard Settings, Restore with a recovery code asks for the code, makes a new key on the computer, and sends both to the server. In one atomic step the server swaps the code for a fresh one, so it is single use even under simultaneous attempts.
- A successful restore (see ADR 0006) cancels every other computer's key, every browser session, every pending sign-in link and every linking code, and makes the new computer the account's only computer. Adding a computer without signing out the others is done with a link code. It returns a fresh recovery code so the account is never left without one. The page and the add-on show it once, with Copy and a save-to-file option. The page requires a "saved" tick before it can be closed.
- Restoring needs no sign-in, so it is rate limited to 10 attempts an hour per address, and making codes to 5 a day per account. A wrong, malformed or used code all get the same answer.
- Reset this computer's key leaves the recovery code valid. Deleting the account deletes it.

## Consequences

Positive:

- A lost secret no longer means a lost account, and the cost to the service is two small endpoints and two columns.
- The code is independent of the secret, so showing it does not expose the credential in daily use.

Negative and accepted:

- The code must be made before the secret is lost. Users who never make one have no recovery.
- Anyone who obtains the code can take over the account until it is used or replaced. It is as sensitive as the secret and the page says so.
- The code is shown once, so a user who closes the dialog without saving it has to replace it.
