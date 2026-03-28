import { expect, test } from "@playwright/test";

test("loads the home page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/UL Bus Tracker|UL Busskarta/i);
  await expect(page.locator("#root")).toBeVisible();
});

test("opens the settings page from the map", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Open settings|Öppna inställningar/i }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: /Settings|Inställningar/i })).toBeVisible();
});