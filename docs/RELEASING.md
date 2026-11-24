# Releasing

The website and the add-on ship separately. The Worker serves the API and the website from one deployment, so deploying updates both of those at once. The add-on lives on people's computers and only changes when they install a new file.

## What can change freely

The website: pages, styling, text and the Help page. Add-ons never read them. The one exception is the `/signin` page, because the add-on opens `/signin#<token>`. Keep that route working.

## What must stay compatible with installed add-ons

The add-on calls `/api/register`, `/api/sync`, `/api/login-link` and `/api/identity/rotate`. People can run an old add-on for a long time, so changes to those endpoints must keep the old requests and replies working: only add fields, never rename or remove them, and never make a new field required. The add-on ignores reply fields it does not know. `tests/addon/test_contract.py` runs the real add-on against a real local Worker, and CI runs it before every deploy. If you must break compatibility, raise the minimum version and tell users to update first.

## Releasing a new add-on version

1. Change `ADDON_VERSION` in `addon/core.py` and update `docs` or the Help page if the steps changed.
2. Run `npm run test:all`, then `npm run package:addon`.
3. Create the release with the file attached: `gh release create vX.Y.Z dist/anki_leaderboard.ankiaddon --prerelease`.
4. Only now change `ADDON_LATEST_VERSION` in `wrangler.jsonc` to the same number and push. The deploy then tells installed add-ons that an update exists. Doing this after the release is published means nobody is told about a file they cannot download yet.

Add-ons older than 0.2.0 have no update check, so they never see the notice.

## Releasing the website or API only

Merge to `main`. When the checks pass, CI deploys. Nothing else is needed, and installed add-ons are unaffected as long as the compatibility rules above hold.
