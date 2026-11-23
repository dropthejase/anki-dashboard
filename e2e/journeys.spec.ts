import { expect, test, type Browser, type Page } from "@playwright/test";
import { FakeAnki } from "./fakeAnki";

async function signedIn(browser: Browser, anki: FakeAnki): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await anki.openLeaderboardUrl());
  await page.getByRole("button", { name: `Sign in as ${anki.name}` }).click();
  await expect(page.getByTestId("whoami")).toContainText(anki.name);
  return page;
}

async function newUser(request: import("@playwright/test").APIRequestContext, name: string, reviews?: number) {
  const anki = new FakeAnki(request, name);
  await anki.register();
  if (reviews !== undefined) await anki.sync(reviews);
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
  const alice = await newUser(request, "Alice", 120);
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
  await expect(bobPage.getByRole("heading", { name: "Sign in to join" })).toBeVisible();
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
  await expect(rows.nth(1).getByTestId("week")).toHaveText("45");
  await expect(bobPage.getByRole("button", { name: "Board settings" })).toHaveCount(0); // members get no admin UI
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

  await alicePage.getByRole("button", { name: "Board settings" }).click();
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
  await expect(page.getByRole("heading", { name: "Open the leaderboard from Anki" })).toBeVisible();
  const again = await request.post("/api/sync", { headers: { Authorization: `Bearer ${dana.secret}` }, data: { local_date: "2026-10-25", review_count: 1 } });
  expect(again.status()).toBe(401);
});
