# ADR 0004: Equal admins and board lifecycle rules

- Status: Accepted
- Date: 2026-11-23
- Deciders: Project owner

## Context

A board needs people who can manage it, and it must never end up with members but nobody able to manage it. The project has no accounts that can be reset by a support team, so the rules must hold on their own.

## Options considered

1. **A single owner.** Simple, but when the owner leaves or goes inactive the board is stuck, and a transfer flow is needed.
2. **An owner plus admins.** Protects the creator but adds a second privileged role and more rules.
3. **Several equal admins, with guards.** Chosen.

## Decision

- A board has any number of admins and members. All admins have the same powers: rename the board, set a member limit, switch the invite link on or off or replace it, promote and demote, remove members, and delete the board.
- Deleting a board needs the exact board name typed as confirmation. It removes the board and its memberships. Accounts and review stats are untouched.
- The last admin cannot leave, be demoted or be removed while other members remain. Each rule is a single guarded SQL statement, so two admins acting at the same moment cannot defeat it.
- When an account is deleted or purged for inactivity, the longest-standing active member is promoted first if that account was the only admin. Boards left with no members are deleted.
- As a safety net, the daily job promotes a member on any board found with members and no admin.
- Non-members always get the same 404 as a missing board.

## Consequences

Positive:

- No special owner state to transfer, and no board can be left unmanageable.

Negative and accepted:

- With no owner, any admin can demote, remove or delete the board of another admin, including the person who created it. Admins should be promoted with care.
- Deleting a board is immediate for everyone and cannot be undone.
