/**
 * mastodon-interop.spec.ts
 *
 * Playwright end-to-end test that proves Mastodon can discover and render a
 * Spirits ActivityPub actor profile.
 *
 * Prerequisites (handled by test_mastodon_interop.sh):
 *   - /etc/hosts: 127.0.0.1 mastodon.test spirits.test
 *   - Docker stack running: docker compose -f test/docker-compose.test.yml up -d
 *   - Mastodon admin account created via tootctl
 *   - Spirits seeded (spirit id=1 = "Stoic Philosopher", username "stoic")
 */
import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ── Configuration ─────────────────────────────────────────────────────────────

const SPIRIT_ACTOR_URL = "https://spirits.test/spirits/1";
const SPIRIT_NAME = "Stoic Philosopher";
const SPIRIT_HANDLE = "@stoic@spirits.test";

const MASTODON_EMAIL = process.env.MASTODON_ADMIN_EMAIL ?? "admin@mastodon.test";
const MASTODON_PASSWORD = process.env.MASTODON_ADMIN_PASSWORD ?? "test_spirits_password";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function signIn(page: Page) {
  await page.goto("/auth/sign_in");
  await page.fill('[name="user[email]"]', MASTODON_EMAIL);
  await page.fill('[name="user[password]"]', MASTODON_PASSWORD);
  await page.click('[name="button"][type="submit"]');
  // Wait until we land somewhere other than the sign-in page
  await page.waitForURL((url) => !url.pathname.includes("/auth/sign_in"), {
    timeout: 15_000,
  });
}

function ensureScreenshotsDir() {
  const dir = path.join(__dirname, "screenshots");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Mastodon ↔ Spirits ActivityPub interop", () => {
  test.beforeEach(async ({ page }) => {
    ensureScreenshotsDir();
    await signIn(page);
  });

  test("Mastodon resolves the spirit actor via federated search", async ({ page }) => {
    // Navigate to the Mastodon search page
    await page.goto("/search");

    // Enter the spirit's actor URL into the search box
    const searchInput = page.locator('[placeholder*="Search"], [aria-label*="Search"], input[type="text"]').first();
    await searchInput.fill(SPIRIT_ACTOR_URL);
    await searchInput.press("Enter");

    // Mastodon triggers a background Sidekiq job to fetch the actor via AP.
    // Wait generously for the profile card to appear in results.
    const profileCard = page.locator(".account-card, .search-result--account, [data-id]").filter({
      hasText: SPIRIT_NAME,
    });
    await expect(profileCard).toBeVisible({ timeout: 60_000 });

    // Assert the federated handle is visible somewhere on the page
    await expect(page.locator(`text=${SPIRIT_HANDLE}`).first()).toBeVisible({ timeout: 10_000 });

    // Screenshot proof
    await page.screenshot({
      path: path.join(__dirname, "screenshots", "mastodon-spirit-search-result.png"),
      fullPage: false,
    });
  });

  test("Mastodon renders the spirit actor profile page", async ({ page }) => {
    // Navigate directly to the remote profile URL — Mastodon will do a federated
    // lookup and render the profile if it's a known AP actor.
    await page.goto(`/@stoic@spirits.test`);

    // If Mastodon hasn't fetched the actor yet, this may redirect to a 'not found'
    // page; the search test should run first to trigger the fetch.
    const heading = page.locator("h1, .account__header__bio, .public-account-header__tabs__name").filter({
      hasText: SPIRIT_NAME,
    });
    await expect(heading.first()).toBeVisible({ timeout: 60_000 });

    // Verify the full handle
    await expect(page.locator(`text=${SPIRIT_HANDLE}`).first()).toBeVisible({ timeout: 10_000 });

    // Screenshot proof
    await page.screenshot({
      path: path.join(__dirname, "screenshots", "mastodon-spirit-profile.png"),
      fullPage: true,
    });
  });
});
