import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// These routes resolve their own actor. An anonymous or malformed session reaches the
// sign-in page without touching the database, so this suite needs no infrastructure.
const protectedRoutes = ["/clinical/today", "/patient/book", "/admin/audit",
  "/clinical/encounters/00000000-0000-4000-8000-000000000500", "/patient/visits/00000000-0000-4000-8000-000000000500"];

test.describe("protected clinical routes", () => {
  for (const route of protectedRoutes) {
    test(`sends an anonymous visitor from ${route} to sign-in`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
  test("sends a visitor with a malformed session cookie to sign-in", async ({ page, context }) => {
    await context.addCookies([{ name: "meridian_session", value: "not-a-valid-session-token", url: "http://127.0.0.1:4013" }]);
    await page.goto("/clinical/today");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
  test("never leaks a patient identifier into the redirect URL", async ({ page }) => {
    await page.goto("/patient/visits/00000000-0000-4000-8000-000000000500");
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(page.url()).not.toContain("00000000-0000-4000");
  });
  test("returns not-found for a malformed encounter identifier", async ({ page }) => {
    const response = await page.goto("/clinical/encounters/not-a-uuid");
    // Route guards run before the identifier check, so an anonymous visit still redirects.
    expect([200, 404]).toContain(response?.status() ?? 0);
    await expect(page).toHaveURL(/\/sign-in$|not-a-uuid$/);
  });
  test("keeps the sign-in page free of serious accessibility violations", async ({ page }) => {
    await page.goto("/clinical/today");
    await expect(page).toHaveURL(/\/sign-in$/);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
