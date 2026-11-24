# ADR 0007: Board pictures

- Status: Accepted
- Date: 2026-11-24
- Deciders: Project owner

## Context

Admins wanted a small picture for their board, shown as a circle on the boards list and the board page. The project must stay free, so no paid storage service, and it must not let anyone store something that runs in another person's browser.

## Options considered

1. **Cloudflare R2 object storage.** Built for files, but it needs a payment method on the account even for the free allowance, which breaks the no-cost rule.
2. **Store the picture in D1.** Free, no new service, and deleted with the board. D1 rows are not meant for large files, so the picture must be small.
3. **Link to a picture hosted elsewhere.** Nothing to store, but it lets any website see who opens the board, and the picture can change or disappear.

## Decision

Option 2. The picture lives in its own table, `board_images`, so listing boards never reads image bytes.

- The browser does the cropping. The admin chooses a JPG, PNG or WebP, drags and zooms it inside a round window, and the page saves it as a 192-pixel square JPEG. Re-encoding in the browser also drops any metadata, such as location.
- The Worker accepts only a JPEG of 100 bytes to 48 KB, checked by content type and by the start and end markers, and read as a capped stream. It does not decode the picture. Whatever the bytes contain, they are always served as `image/jpeg` with `nosniff` and `Content-Security-Policy: sandbox`, so they are never run.
- Only admins can set or remove it. Only members can fetch it. Everyone else gets the same 404 as a missing board. People who open an invite link do not see the picture before joining.
- The picture's address carries its version (`?v=<time set>`), so it is cached for a year and a new picture gets a new address.
- Boards without a picture show a circle with the board's first letter.

## Consequences

Positive:

- No new service, no cost, and a deleted board takes its picture with it.
- Board lists stay light: they carry only a version number.

Negative or accepted:

- Each picture adds up to 48 KB to the database. With the free 5 GB limit that allows tens of thousands of pictures, and the real size is nearer 10 to 20 KB.
- The server cannot prove the bytes are a viewable picture, only that they look like a JPEG. A broken file shows the letter instead.
- A client that skips the browser's re-encoding could upload a JPEG that still carries metadata. Only members of that board can see it.
- An admin can upload an unsuitable picture. Only that board's members see it, and any admin can replace or remove it.
