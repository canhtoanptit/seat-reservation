/**
 * Smoke E2E. Drives the full UI happy path once: signup → seats → reserve →
 * pay → confirmation. The integration tests carry the correctness load; this
 * just proves the wiring works in a real browser.
 */

import { test, expect } from "@playwright/test";

test("signup → reserve → pay → confirmed", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = "correct-horse-battery-staple";

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/seats");
  await expect(page.getByRole("heading", { name: "Pick a seat" })).toBeVisible();

  // Pick the first available seat
  const reserveBtns = page.getByRole("button", { name: "Reserve" });
  const count = await reserveBtns.count();
  expect(count).toBeGreaterThan(0);
  await reserveBtns.first().click();

  await page.waitForURL("**/reservations/**");
  await expect(page.getByRole("heading", { name: "Reservation" })).toBeVisible();

  await page.getByRole("button", { name: "Pay now" }).click();

  // Land on the mock provider
  await page.waitForURL("**/mock-pay/**");
  await page.getByRole("button", { name: "Succeed" }).click();

  // Back on reservation page, status should be confirmed (give the webhook
  // a moment to land).
  await page.waitForURL("**/reservations/**");
  await expect(page.getByText("Your seat is confirmed.")).toBeVisible({
    timeout: 10_000,
  });

  // Verify on /seats that the seat shows as taken-by-me (or as the user's hold)
  await page.goto("/seats");
  await expect(page.getByText("Confirmed — view")).toBeVisible();
});
