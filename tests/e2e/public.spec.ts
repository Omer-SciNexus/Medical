import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public homepage links to account creation, sign-in, and the existing preview", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Less between you and better care." })).toBeVisible();
  await page.getByRole("link", { name: "Create your workspace", exact: true }).first().click();
  await expect(page).toHaveURL("/sign-up");
  await expect(page.getByRole("heading", { name: "A fresh start for your clinic." })).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.getByRole("link", { name: "Back to home" }).click();
  await page.getByRole("link", { name: "Explore the preview", exact: true }).first().click();
  await expect(page).toHaveURL("/design");
});

test("sign-in validates, preserves input, and gives an honest service status", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.getByLabel("Email address").fill("synthetic@example.test");
  await page.getByLabel("Password", { exact: true }).fill("A synthetic test passphrase");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  if (await page.getByRole("status").filter({ hasText: "Account services are being connected" }).count()) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Account services are not available");
    await expect(page.getByLabel("Email address")).toHaveValue("synthetic@example.test");
    expect((await page.context().cookies()).find((cookie) => cookie.name === "meridian_session")).toBeUndefined();
  }
  await page.getByText("Need help signing in?").click();
  // A forgotten password is self-serve; only a missing account needs the administrator.
  await expect(page.getByText(/use a saved recovery code after entering your password/)).toBeVisible();
  await expect(page.getByText(/For a missing account, contact your clinic administrator/)).toBeVisible();
  // The target, not a click: a soft navigation competing with the axe worker for this machine is
  // slow in a way that says nothing about the page, which the next test visits directly.
  await expect(page.getByRole("link", { name: "Reset it by email" })).toHaveAttribute("href", "/forgot-password");
});

test("password reset asks for an address, validates it, and promises nothing about who has an account", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "It happens." })).toBeVisible();
  await expect(page.getByText(/single-use link/)).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveAttribute("type", "email");
  await page.getByRole("button", { name: "Send the link", exact: true }).click();
  // Unconfigured, the action reports that before it validates, so which feedback appears depends
  // on the environment; what must hold either way is that nothing is sent and no session begins.
  if (await page.getByRole("status").filter({ hasText: "Account services are being connected" }).count()) {
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Account services are not available");
  } else {
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  }
  expect((await page.context().cookies()).find((cookie) => cookie.name === "meridian_session")).toBeUndefined();
  await expect(page.getByRole("link", { name: "Back to sign-in" })).toHaveAttribute("href", "/sign-in");
});

test("a reset link that cannot be used says so instead of offering a password form", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This link cannot be used." })).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
});

test("registration validates names and confirmation without creating an account", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create your workspace", exact: true }).click();
  await expect(page.getByLabel("Full name")).toBeFocused();
  await page.getByLabel("Full name").fill("Test Owner");
  await page.getByLabel("Clinic name").fill("Synthetic Clinic");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("A synthetic test passphrase");
  await page.getByLabel("Confirm password", { exact: true }).fill("A different test passphrase");
  await page.getByRole("button", { name: "Create your workspace", exact: true }).click();
  await expect(page.getByText("Your passwords don’t match.")).toBeVisible();
  await expect(page.getByLabel("Confirm password", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Full name")).toHaveValue("Test Owner");
  await page.getByLabel("Confirm password", { exact: true }).fill("A synthetic test passphrase");
  if (await page.getByRole("status").filter({ hasText: "Account services are being connected" }).count()) {
    await page.getByRole("button", { name: "Create your workspace", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Account services are not available");
    expect((await page.context().cookies()).find((cookie) => cookie.name === "meridian_session")).toBeUndefined();
  }
});

test("dashboard requires a session and rejects a malformed cookie", async ({ page, context }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/sign-in");
  await context.addCookies([{ name: "meridian_session", value: "forged-session", url: "http://127.0.0.1:4000" }]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Good to have you back." })).toBeVisible();
});

for (const route of ["/", "/sign-in", "/sign-up", "/forgot-password"]) test(`${route} accessibility and responsive layout`, async ({ page }) => {
  await page.goto(route);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations).toEqual([]);
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const slug = route === "/" ? "home" : route.slice(1);
    if (width === 1440 || width === 390) await page.screenshot({ path: `.artifacts/meridian-${slug}-${width}.png`, fullPage: true });
  }
});

test("mobile navigation and FAQ work without a separate navigation library", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Open navigation").click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "The platform", exact: true }).click();
  await expect(page).toHaveURL("/#platform");
  await page.getByText("Can I try the interface before creating an account?").click();
  await expect(page.getByRole("link", { name: "Open the design preview", exact: true })).toBeVisible();
});

test("leaving the dark preview restores the public page theme", async ({ page }) => {
  await page.goto("/design");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Meridian home", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});
