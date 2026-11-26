import { expect, test, type Browser, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { FakeAnki } from "./fakeAnki";

async function signedIn(browser: Browser, anki: FakeAnki): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await anki.openLeaderboardUrl());
  await page.getByRole("button", { name: `Sign in as ${anki.name}` }).click();
  await expect(page.getByTestId("whoami")).toContainText(anki.name);
  return page;
}

async function newUser(request: import("@playwright/test").APIRequestContext, name: string, reviews?: number, stats?: Record<string, unknown>) {
  const anki = new FakeAnki(request, name);
  await anki.register();
  if (reviews !== undefined) await anki.sync(reviews, stats);
  return anki;
}

test("sign-in shows an interstitial, clears the token, and the link is single use", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice");
  const url = await alice.openLeaderboardUrl();
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await expect(page.getByTestId("signin-name")).toHaveText("Alice");
  expect(page.url()).not.toContain("#"); // token moved out of the address bar
  // Nothing is signed in until the user confirms.
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await page.getByRole("button", { name: "Sign in as Alice" }).click();
  await expect(page.getByTestId("whoami")).toContainText("Alice");

  const second = await (await browser.newContext()).newPage();
  await second.goto(url);
  await expect(second.getByRole("alert")).toContainText("expired or was already used");
});

test("create a board, invite through the link, and see counts and admin controls", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice", 120, { days_studied: 21, retention_today: [45, 5], retention_week: [300, 40], retrievability: 0.9 });
  const bob = await newUser(request, "Bob", 45);
  const alicePage = await signedIn(browser, alice);

  await alicePage.getByLabel("Board name").first().fill("SQE1 crew");
  await alicePage.getByRole("button", { name: "Create" }).click();
  await expect(alicePage.getByTestId("board-name")).toHaveText("SQE1 crew");
  const invite = await alicePage.getByTestId("invite-url").textContent();
  expect(invite).toMatch(/\/join#[0-9a-f]{32}\./);

  // Bob is signed out when he opens the link, then signs in from "Anki" and resumes.
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await bobPage.goto(invite!);
  await expect(bobPage.getByRole("heading", { name: "You have been invited to a private Anki leaderboard" })).toBeVisible();
  // The invite page points new people to the install steps on the Help page.
  await bobPage.getByRole("link", { name: "Install", exact: true }).click();
  await expect(bobPage.getByRole("heading", { name: "Get started" })).toBeVisible();
  await bobPage.goto(await bob.openLeaderboardUrl());
  await bobPage.getByRole("button", { name: "Sign in as Bob" }).click();
  await expect(bobPage.getByRole("heading", { name: "Join “SQE1 crew”?" })).toBeVisible();
  await bobPage.getByRole("button", { name: "Join board" }).click();
  await expect(bobPage.getByTestId("board-name")).toHaveText("SQE1 crew");

  const rows = bobPage.getByTestId("member-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Alice");
  await expect(rows.nth(0).getByTestId("today")).toHaveText("120");
  await expect(rows.nth(1)).toContainText("Bob");
  await expect(rows.nth(1).getByTestId("today")).toHaveText("45");
  // The 7 days tab ranks and shows the weekly totals instead.
  await bobPage.getByRole("tab", { name: "7 days" }).click();
  await expect(bobPage.getByRole("tab", { name: "7 days" })).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(0).getByTestId("week")).toHaveText("120");
  await expect(rows.nth(1).getByTestId("week")).toHaveText("45");
  // The Stats tab charts Anki statistics. Alice sent some, Bob did not.
  await bobPage.getByRole("tab", { name: "Stats" }).click();
  const statRows = bobPage.getByTestId("stat-row");
  await expect(statRows).toHaveCount(2);
  await expect(statRows.nth(0)).toContainText("Alice");
  await expect(statRows.nth(0).getByTestId("stat-value")).toHaveText("21 / 30");
  await expect(statRows.nth(1)).toContainText("Bob");
  await expect(statRows.nth(1).getByTestId("stat-value")).toHaveText("\u2014");
  await bobPage.getByLabel("Statistic").selectOption("week");
  await expect(statRows.nth(0).getByTestId("stat-value")).toContainText("88%");
  await bobPage.getByRole("tab", { name: "Today" }).click();
  await bobPage.getByRole("button", { name: "Board options" }).click();
  await expect(bobPage.getByRole("menuitem", { name: "Leave board" })).toBeVisible();
  await expect(bobPage.getByRole("menuitem", { name: "Board settings" })).toHaveCount(0); // members get no admin UI
  await bobPage.keyboard.press("Escape");
  await expect(bobPage.getByRole("heading", { name: "Admin settings" })).toHaveCount(0);

  // Admin removes Bob; Bob loses access immediately.
  await alicePage.getByRole("button", { name: "Refresh" }).click();
  await expect(alicePage.getByTestId("member-row")).toHaveCount(2);
  await alicePage.getByRole("button", { name: /^Actions for / }).click();
  await alicePage.getByRole("menuitem", { name: "Remove from board" }).click();
  await alicePage.getByRole("menu").getByRole("button", { name: "Remove" }).click();
  await expect(alicePage.getByTestId("member-row")).toHaveCount(1);
  await bobPage.reload();
  await expect(bobPage.getByRole("heading", { name: "Board not found" })).toBeVisible();
});

test("turning the invite link off and regenerating it blocks old links", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice");
  const carol = await newUser(request, "Carol");
  const alicePage = await signedIn(browser, alice);
  await alicePage.getByLabel("Board name").first().fill("Private");
  await alicePage.getByRole("button", { name: "Create" }).click();
  const oldInvite = (await alicePage.getByTestId("invite-url").textContent())!;

  await alicePage.getByRole("button", { name: "Board options" }).click();
  await alicePage.getByRole("menuitem", { name: "Board settings" }).click();
  // The member limit field only keeps digits, and is capped at three of them.
  const limit = alicePage.getByLabel("Member limit");
  await limit.fill("-5e3.7");
  await expect(limit).toHaveValue("537");
  await limit.fill("");
  await alicePage.getByRole("button", { name: "Regenerate link" }).click();
  await alicePage.getByRole("button", { name: "Yes" }).click();
  await expect(alicePage.getByTestId("invite-url")).not.toHaveText(oldInvite);

  const carolPage = await signedIn(browser, carol);
  await carolPage.goto(oldInvite);
  await expect(carolPage.getByRole("heading", { name: "Invite not valid" })).toBeVisible();

  const newInvite = (await alicePage.getByTestId("invite-url").textContent())!;
  await alicePage.getByRole("button", { name: "Turn invite link off" }).click();
  await expect(alicePage.getByText("The invite link is off")).toBeVisible();
  await carolPage.goto(newInvite);
  await expect(carolPage.getByRole("heading", { name: "Invite not valid" })).toBeVisible();
});

test("theme follows the system and can be toggled; layout fits a phone", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice", 10);
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto(await alice.openLeaderboardUrl());
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Sign in as Alice" }).click();
  await page.getByLabel("Board name").first().fill("Mobile");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("board-name")).toBeVisible();

  const toggle = page.getByRole("button", { name: /^Theme:/ });
  await toggle.click(); // system -> light
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await toggle.click(); // light -> dark
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/); // choice persists

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("security headers and rendering of hostile names", async ({ browser, request, page }) => {
  const res = await page.goto("/");
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res!.headers()["strict-transport-security"]).toContain("max-age=");
  expect(res!.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(res!.headers()["permissions-policy"]).toContain("camera=()");

  // Names with markup are refused by the API, so nothing hostile can reach a board.
  const r = await request.post("/api/register", {
    headers: { Authorization: `Bearer ${"a".repeat(43)}` },
    data: { display_name: "<img src=x onerror=alert(1)>" },
  });
  expect(r.status()).toBe(400);
  void browser;
});

test("account deletion removes the user and signs them out", async ({ browser, request }) => {
  const dana = await newUser(request, "Dana", 5);
  const page = await signedIn(browser, dana);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page.getByRole("heading", { name: "A private leaderboard for Anki" })).toBeVisible();
  const again = await request.post("/api/sync", { headers: { Authorization: `Bearer ${dana.secret}` }, data: { local_date: "2026-10-25", review_count: 1 } });
  expect(again.status()).toBe(401);
});

test("an admin deletes a board by typing its name, and members lose it", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice");
  const bob = await newUser(request, "Bob");
  const alicePage = await signedIn(browser, alice);
  await alicePage.getByLabel("Board name").first().fill("Doomed");
  await alicePage.getByRole("button", { name: "Create" }).click();
  const invite = (await alicePage.getByTestId("invite-url").textContent())!;
  const bobPage = await signedIn(browser, bob);
  await bobPage.goto(invite);
  await bobPage.getByRole("button", { name: /Join/ }).click();
  await expect(bobPage.getByTestId("board-name")).toHaveText("Doomed");

  await alicePage.getByRole("button", { name: "Board options" }).click();
  await alicePage.getByRole("menuitem", { name: "Board settings" }).click();
  await alicePage.getByRole("button", { name: "Delete board" }).click();
  const dialog = alicePage.getByRole("dialog", { name: "Delete this board?" });
  const confirmDelete = dialog.getByRole("button", { name: "Delete board" });
  await expect(confirmDelete).toBeDisabled();
  await dialog.getByRole("textbox").fill("Doomed");
  await confirmDelete.click();
  await expect(alicePage.getByText("You are not on any board yet")).toBeVisible();

  await bobPage.reload();
  await expect(bobPage.getByRole("heading", { name: "Board not found" })).toBeVisible();
});

test("a member leaves a board from the options menu after confirming", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice");
  const bob = await newUser(request, "Bob");
  const alicePage = await signedIn(browser, alice);
  await alicePage.getByLabel("Board name").first().fill("Revolving door");
  await alicePage.getByRole("button", { name: "Create" }).click();
  const invite = (await alicePage.getByTestId("invite-url").textContent())!;
  const bobPage = await signedIn(browser, bob);
  await bobPage.goto(invite);
  await bobPage.getByRole("button", { name: /Join/ }).click();
  await expect(bobPage.getByTestId("board-name")).toHaveText("Revolving door");

  await bobPage.getByRole("button", { name: "Board options" }).click();
  await bobPage.getByRole("menuitem", { name: "Leave board" }).click();
  await expect(bobPage.getByRole("menu").getByText("Leave this board?")).toBeVisible();
  await bobPage.getByRole("menu").getByRole("button", { name: "Leave" }).click();
  await expect(bobPage.getByText("You are not on any board yet")).toBeVisible();
});

test("a recovery code made on the Account page restores the account on a new secret", async ({ browser, request }) => {
  const old = await newUser(request, "Rescued", 12);
  const page = await signedIn(browser, old);
  await page.getByLabel("Board name").first().fill("Survives");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("board-name")).toHaveText("Survives");

  // Make the code in the browser. It must be saved before the dialog can be closed.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page.getByText("You have not made a recovery code yet.")).toBeVisible();
  await page.getByRole("button", { name: "Create recovery code" }).click();
  const dialog = page.getByRole("dialog", { name: "Your recovery code" });
  const code = (await dialog.getByTestId("recovery-code").textContent())!;
  expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  await expect(dialog.getByRole("button", { name: "Done" })).toBeDisabled();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download .txt" }).click();
  expect((await download).suggestedFilename()).toBe("anki-leaderboard-recovery-code.txt");
  await dialog.getByLabel("I have saved this code somewhere safe.").check();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/You made a recovery code on/)).toBeVisible();

  // The identity is lost: a brand new client restores the account with the code.
  const restored = new FakeAnki(request, "Rescued");
  const fresh = await restored.recoverWith(code);
  expect(fresh.recovery_code).not.toBe(code);
  const again = await signedIn(browser, restored);
  await expect(again.getByTestId("whoami")).toContainText("Rescued");
  await again.getByText("Survives").click();
  await expect(again.getByTestId("board-name")).toHaveText("Survives");
  // The old secret no longer works, and the used code is spent.
  expect((await request.post("/api/login-link", { headers: { Authorization: `Bearer ${old.secret}` } })).status()).toBe(401);
  expect((await request.post("/api/recover", { data: { recovery_code: code, new_secret: "x".repeat(43) } })).status()).toBe(400);
});

test("two computers share one account, and removing one cuts it off", async ({ browser, request }) => {
  const first = await newUser(request, "Duo");
  const second = new FakeAnki(request, "Duo");
  await second.linkWith(await first.linkCode());
  await second.sync(30); // either computer can send the count

  const page = await signedIn(browser, second);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  const computers = page.getByRole("list", { name: "Computers" });
  await expect(computers.getByTestId("device-label")).toHaveText(["This computer", "Second computer"]);

  await page.getByRole("button", { name: "Remove Second computer" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(computers.getByTestId("device-label")).toHaveText(["This computer"]);
  await expect(page.getByText(/only computer/)).toBeVisible();

  const cut = await request.post("/api/sync", { headers: { Authorization: `Bearer ${second.secret}` }, data: { local_date: new Date().toISOString().slice(0, 10), review_count: 31 } });
  expect(cut.status()).toBe(401);
  // The remaining computer is still accepted. The account allows one update every 30 minutes, shared by its computers, so this one is told to wait.
  const carryOn = await request.post("/api/sync", { headers: { Authorization: `Bearer ${first.secret}` }, data: { local_date: new Date().toISOString().slice(0, 10), review_count: 40 } });
  expect(carryOn.status()).toBe(429);
});


/** A plain RGB PNG with a gradient, made here so the test needs no fixture file. */
function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    for (let x = 0; x < width; x++) rows.push(Math.floor((x / width) * 255), Math.floor((y / height) * 255), 128);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test("an admin gives a board a picture, members see it, and a long name never runs under it", async ({ browser, request }) => {
  const alice = await newUser(request, "Alice", 10);
  const bob = await newUser(request, "Bob", 5);
  const alicePage = await signedIn(browser, alice);
  const longName = "A".repeat(20) + " " + "very-long-board-name-".repeat(2) + "end";
  await alicePage.getByLabel("Board name").first().fill(longName.slice(0, 60));
  await alicePage.getByRole("button", { name: "Create" }).click();
  await expect(alicePage.getByTestId("board-name")).toBeVisible();
  const invite = (await alicePage.getByTestId("invite-url").textContent())!;

  await alicePage.getByRole("button", { name: "Board options" }).click();
  await alicePage.getByRole("menuitem", { name: "Board settings" }).click();
  await alicePage.getByLabel("Choose a picture").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: makePng(300, 200) });
  const canvas = alicePage.getByLabel(/Picture position/);
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await alicePage.mouse.move(box.x + 120, box.y + 120);
  await alicePage.mouse.down();
  await alicePage.mouse.move(box.x + 60, box.y + 120, { steps: 4 });
  await alicePage.mouse.up();
  await alicePage.getByLabel("Zoom").fill("2");
  await alicePage.getByRole("button", { name: "Save picture" }).click();
  await expect(alicePage.getByRole("button", { name: "Change picture" })).toBeVisible();
  await expect(alicePage.locator('img[src*="/image?v="]').first()).toBeVisible();

  // The saved picture really loads, and is a small square JPEG.
  const src = (await alicePage.locator('img[src*="/image?v="]').first().getAttribute("src"))!;
  const res = await alicePage.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  expect((await res.body()).length).toBeLessThan(48 * 1024);

  // On the boards list the name and the picture sit side by side without overlapping.
  await alicePage.goto("/");
  const card = alicePage.getByRole("link", { name: new RegExp(longName.slice(0, 12)) });
  const name = (await card.locator("span.line-clamp-2").boundingBox())!;
  const pic = (await card.locator("img").boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(pic.x);

  // A member sees it too, once they have joined.
  const bobPage = await signedIn(browser, bob);
  await bobPage.goto(invite);
  await bobPage.getByRole("button", { name: /Join/ }).click();
  await expect(bobPage.locator('img[src*="/image?v="]').first()).toBeVisible();

  // Removing it brings back the letter.
  await alicePage.goto("/");
  await card.click();
  await alicePage.getByRole("button", { name: "Board options" }).click();
  await alicePage.getByRole("menuitem", { name: "Board settings" }).click();
  await alicePage.getByRole("button", { name: "Remove picture" }).click();
  await expect(alicePage.getByRole("button", { name: "Add picture" })).toBeVisible();
});
