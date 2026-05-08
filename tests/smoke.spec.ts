import { expect, test } from "@playwright/test";

test("game boots and shows menu", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(2000);
  const screenshot = await page.locator("canvas").screenshot();
  expect(screenshot.length).toBeGreaterThan(1000);
});

test("no console errors on boot", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForTimeout(3000);
  const ignored = ["yandex.ru/games/sdk", "YaGames"];
  const real = errors.filter((e) => !ignored.some((s) => e.includes(s)));
  expect(real).toEqual([]);
});
