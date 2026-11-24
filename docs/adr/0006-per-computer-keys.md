# ADR 0006: Each computer has its own key, linked to one account

- Status: Accepted
- Date: 2026-11-24
- Deciders: Project owner

## Context

ADR 0001 stored one identity secret in the Anki collection settings and relied on AnkiWeb to copy it to the user's other computers. The first live test showed that this is fragile. Three accounts appeared within about 85 seconds for one person, so the secret was being lost and recreated. We could not confirm how Anki merges those settings during sync, only that a key stored there cannot be relied on. The design also had two other weaknesses: it uploaded the user's login credential to AnkiWeb and into every backup of the collection, and one value shared by every computer meant that losing it anywhere meant losing it everywhere.

## Options considered

1. **Keep the secret in the collection and add a second local copy as a safety net.** Fixes the repeated accounts on one computer, but still uploads the credential to AnkiWeb and still gives every computer the same key.
2. **One key the user keeps and types in on every computer.** Robust, but every user, including those with one computer, must handle a key from the first minute.
3. **A separate key per computer, linked to one account.** Chosen.

## Decision

- The add-on makes a random 256-bit key on each computer and stores it in a private file in the add-on's own `user_files` folder, readable only by the user. It is not in the collection, so Anki's sync never copies or overwrites it, and it never goes to AnkiWeb.
- The server stores one hash per computer in a `devices` table. An account can have up to ten computers.
- **First computer:** no typing. The first time the person chooses Open Leaderboard, the add-on asks "Do you already have a leaderboard account?", and sets up an account if the answer is no. The add-on never creates an identity unprompted, and a sync does nothing until the computer is set up.
- **Adding a computer:** on an existing computer the person chooses Show a code for my other computer (Tools, Leaderboard Settings) and gets a 12-character code (60 bits) that works once and expires in 10 minutes. On the new computer they choose Add this computer to my account and type it. The server stores only the code's hash, and allows 10 attempts an hour per address and 5 new codes an hour per account.
- **Removal:** the Account page lists the computers. Any computer except the last can be removed, and it stops working at once.
- **A removed or unknown computer does not start a new account.** The add-on remembers that the server once accepted it, and if the server later forgets it, the add-on discards its key and asks the person to set up again, instead of registering a new account.
- **Recovery code (ADR 0005):** used on a fresh install, it adds that computer to the old account and signs out every other computer, browser session and pending code, on the assumption that something has gone wrong.
- Resetting a key (Leaderboard Settings, Reset this computer's key) replaces only that computer's key.

## Consequences

Positive:

- A sync can no longer lose or overwrite the key.
- The credential is no longer visible to AnkiWeb or in collection backups. This removes one of the accepted risks in the threat model.
- A lost or stolen computer is revoked on its own.
- People with one computer do nothing extra.

Negative and accepted:

- A second computer needs a linking step. If someone sets it up as a first computer by mistake they get a second account, and the add-on asks to prevent this.
- The key is a plain file on the computer. It is readable by anything running as that user, including other add-ons and backups of the Anki folder. The file is private to the user and kept out of the add-on's Config window.
- The 30 minute update limit is per account, so two computers on one account share it.
- **One leaderboard account per computer, not per Anki profile.** The key lives in the add-on's folder, and an add-on is shared by every profile on a computer. If several profiles share a computer they share one account: they appear as one person, and the server keeps the highest of their daily counts rather than adding them up. Anki's manual describes profiles as being for several people sharing a computer, each syncing to its own AnkiWeb account, so this is expected to be rare. A later change could keep the key and the "last sent" note in each profile's own folder, which would make each profile its own account. The count only ever rises, so the next sync carries the latest number.

## Not yet verified

- Nothing outstanding about the key. Checked on real Anki Desktop (macOS): linking between two laptops works, and the key survived updating the add-on from 0.3.0 to 0.3.1.
- Windows and Linux are untested.
