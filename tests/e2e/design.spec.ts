import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("clinical and patient registers support keyboard selection and truthful preview actions", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Designed for the work of care." })).toBeVisible();
  await page.getByRole("button", { name: "Preview Aylin Yılmaz" }).focus();
  await page.keyboard.press("j");
  await expect(page.getByRole("button", { name: "Preview Emre Demir" })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Selected synthetic patient" })).toContainText("DEMİR, Emre");
  await page.getByRole("tab", { name: "Patient", exact: true }).click();
  await page.getByRole("radio", { name: "10:40" }).click();
  await page.getByRole("button", { name: "Review appointment" }).click();
  await expect(page.getByRole("dialog")).toContainText("10:40");
  await expect(page.getByRole("dialog")).toContainText("No appointment will be booked");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Review appointment" })).toBeFocused();
});

test("validation and amendment confirmation require deliberate input", async ({ page }) => {
  await page.goto("/design");
  await page.getByRole("button", { name: "Save example" }).click();
  await expect(page.locator("#example-reason-error")).toHaveText("Add a short reason for the visit, at least 5 characters.");
  await page.getByLabel("Reason for visit", { exact: true }).fill("Blood pressure follow-up");
  await page.getByRole("button", { name: "Save example" }).click();
  await expect(page.getByText("Example validated · preview only")).toBeVisible();
  await page.getByRole("button", { name: "Review amendment" }).click();
  await expect(page.getByRole("button", { name: "Confirm preview" })).toBeDisabled();
  await page.getByLabel("Reason for the amendment").fill("Correct the documented observation time.");
  await page.getByLabel("Type AMEND to acknowledge").fill("AMEND");
  await page.getByRole("button", { name: "Confirm preview" }).click();
  await expect(page.getByText("Confirmation preview complete. No record was changed.")).toBeVisible();
});

test("command palette navigates with the keyboard and dialog contains focus", async ({ page }) => {
  await page.goto("/design");
  // Confirm hydration before sending a global keyboard shortcut.
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByRole("combobox", { name: "Search the design library" }).fill("patient");
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("tab", { name: "Patient", exact: true })).toHaveAttribute("data-state", "active");
  await page.getByRole("button", { name: "Review appointment" }).click();
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Review appointment" })).toBeFocused();
});

for (const theme of ["light", "dark"] as const) test(`WCAG automated checks in ${theme} theme`, async ({ page }) => {
  await page.goto("/design");
  if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
  for (const register of ["Clinical", "Patient"]) {
    await page.getByRole("tab", { name: register, exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations).toEqual([]);
    if (theme === "dark" && register === "Clinical") await page.screenshot({ path: ".artifacts/design-clinical-dark-1440.png", fullPage: true });
  }
});

for (const width of [390, 768, 1440]) test(`responsive layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/design");
  for (const register of ["Clinical", "Patient"]) {
    await page.getByRole("tab", { name: register, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/design-${register.toLowerCase()}-${width}.png`, fullPage: true });
  }
});

test("reduced motion disables skeleton animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  expect(await page.locator(".skeleton").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});
