/**
 * Captures Yandex Games promo screenshots.
 * Output: 30 files = 3 langs × 2 orientations × 5 scenes.
 * Run: npx tsx scripts/capture-screenshots.ts
 * Requires dev server: npm run dev (on http://127.0.0.1:5173).
 */

import { chromium, type Page, type BrowserContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE_URL = "http://127.0.0.1:5173";
const OUT_DIR = path.resolve(process.cwd(), "promo/screenshots");

const LANGS = ["ru", "en", "tr"] as const;
type Lang = (typeof LANGS)[number];

// Render at phone-typical CSS pixel sizes (so HUD/buttons read at intended scale)
// then upscale via deviceScaleFactor → final PNG is 1920x1080 / 1080x1920.
const ORIENTATIONS = [
  { id: "landscape", w: 1280, h: 720,  dpr: 1.5 }, // → 1920×1080
  { id: "portrait",  w: 540,  h: 960,  dpr: 2.0 }, // → 1080×1920 (smaller CSS → bigger UI)
] as const;

// 5 scenes × different skins so each screenshot looks unique.
type SceneKind = "menu" | "gameplay-a" | "gameplay-shoot" | "gameplay-b" | "upgrade";
const SCENES: { kind: SceneKind; idx: number; name: string; skin: string }[] = [
  { kind: "menu",            idx: 1, name: "menu",      skin: "neon_cyan" },
  { kind: "gameplay-a",      idx: 2, name: "gameplay",  skin: "duo_grape" },
  { kind: "gameplay-shoot",  idx: 3, name: "shoot",     skin: "daily_inferno" },
  { kind: "gameplay-b",      idx: 4, name: "capture",   skin: "duo_ocean" },
  { kind: "upgrade",         idx: 5, name: "upgrade",   skin: "neon_gold" },
];

const ALL_SKIN_IDS = [
  "neon_cyan", "neon_pink", "neon_lime", "neon_amber", "neon_red",
  "neon_violet", "neon_mint", "neon_sky", "neon_rose", "neon_gold",
  "neon_white", "neon_black",
  "duo_split", "duo_lemon", "duo_grape", "duo_sunset", "duo_ocean",
  "daily_coral", "daily_aqua", "daily_lavender", "daily_sun", "daily_jade",
  "daily_blossom", "daily_sapphire", "daily_ember", "daily_glacier",
  "daily_forest", "daily_orchid", "daily_topaz", "daily_obsidian",
  "daily_pearl", "daily_ruby", "daily_lagoon", "daily_storm", "daily_meadow",
  "daily_neon_void", "daily_aurora", "daily_inferno", "daily_celestial",
  "daily_eclipse",
  "daily_duo_reef", "daily_duo_galaxy", "daily_duo_candy", "daily_duo_phoenix",
];

const PLAY_LABEL: Record<Lang, string> = {
  ru: "Играть",
  en: "Play",
  tr: "Oyna",
};

fs.mkdirSync(OUT_DIR, { recursive: true });

async function seedSave(ctx: BrowserContext, skin: string, lang: Lang): Promise<void> {
  await ctx.addInitScript(
    ({ skin, allSkins, lang }) => {
      const save = {
        version: 1,
        coins: 1280,
        bestScore: 12500,
        selectedSkin: skin,
        unlockedSkins: allSkins,
        achievements: {
          first_5pct: 1,
          capture_50pct: 1,
          survive_round: 1,
        },
        dailyClaimedAt: Date.now() - 60_000, // recent claim → no auto-popup
        dailyDayIndex: 5,
        dailyStreak: 5,
        dailyStreakBest: 5,
        roundsPlayed: 10,
        continuesUsedThisRound: 0,
        lbConsent: false,
        pendingLbScore: 0,
        shortcutPromptShown: true,
        tutorialShown: true,
        settings: {
          musicVolume: 0,
          sfxVolume: 0,
          controlScheme: "swipe",
          lang,
          uiScale: 1.0,
        },
      };
      localStorage.setItem("save", JSON.stringify(save));
    },
    { skin, allSkins: ALL_SKIN_IDS, lang },
  );
}

async function waitForMenu(page: Page, lang: Lang): Promise<void> {
  // Wait for splash to fade and Play button to appear.
  await page.waitForFunction(() => {
    const splash = document.getElementById("splash");
    return !splash || splash.classList.contains("hidden") || splash.style.display === "none";
  }, { timeout: 15_000 }).catch(() => {});
  await page.locator("button", { hasText: PLAY_LABEL[lang] }).first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function startGame(page: Page, lang: Lang): Promise<void> {
  await waitForMenu(page, lang);
  await page.locator("button", { hasText: PLAY_LABEL[lang] }).first().click();
  // Cursor away from screen edges so demo controller doesn't yank the hero into a wall.
  await page.mouse.move(100, 100);
}

async function shootArrow(page: Page): Promise<void> {
  // Emit SplitRequest directly via the dev hook — more reliable than synthetic
  // key events, which can race with the input system and the first-round cooldown.
  await page.evaluate(() => {
    type EmitGame = { scene: { getScene(key: string): { events: { emit(k: string, p?: unknown): void } } | null } };
    const g = (window as unknown as { __game?: EmitGame }).__game;
    if (!g) throw new Error("__game not exposed");
    const scene = g.scene.getScene("Game");
    if (!scene) throw new Error("Game scene not found");
    scene.events.emit("split:request");
  });
}

async function emitUpgradeOffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    type EmitGame = { scene: { getScene(key: string): { events: { emit(k: string, p: unknown): void } } | null } };
    const g = (window as unknown as { __game?: EmitGame }).__game;
    if (!g) throw new Error("__game not exposed; ensure ?dev=1");
    const scene = g.scene.getScene("Game");
    if (!scene) throw new Error("GameScene not found");
    scene.events.emit("upgrade:offer", { choices: ["ghostSpeed", "passiveSpeed"] });
  });
}

async function captureOne(
  browser: import("@playwright/test").Browser,
  lang: Lang,
  orientation: typeof ORIENTATIONS[number],
  scene: typeof SCENES[number],
): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: orientation.w, height: orientation.h },
    deviceScaleFactor: orientation.dpr,
  });
  await seedSave(ctx, scene.skin, lang);
  const page = await ctx.newPage();

  const url = `${BASE_URL}/?lang=${lang}&dev=1`;
  await page.goto(url, { waitUntil: "networkidle" });
  await waitForMenu(page, lang);

  switch (scene.kind) {
    case "menu":
      await page.waitForTimeout(600);
      break;
    case "gameplay-a":
      await startGame(page, lang);
      await page.waitForTimeout(5000);
      break;
    case "gameplay-shoot":
      await startGame(page, lang);
      // First-round split cooldown is 4s — wait it out, then shoot.
      await page.waitForTimeout(5000);
      await shootArrow(page);
      await page.waitForTimeout(1300); // catch the arrow mid-flight
      break;
    case "gameplay-b":
      await startGame(page, lang);
      await page.waitForTimeout(10000);
      break;
    case "upgrade":
      await startGame(page, lang);
      await page.waitForTimeout(2000);
      await emitUpgradeOffer(page);
      await page.waitForTimeout(800);
      break;
  }

  const fileName = `${lang}-${orientation.id}-${String(scene.idx).padStart(2, "0")}-${scene.name}.png`;
  const filePath = path.join(OUT_DIR, fileName);
  await page.screenshot({ path: filePath, type: "png" });
  console.log(`✓ ${fileName}`);
  await ctx.close();
}

async function run(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const lang of LANGS) {
      for (const orientation of ORIENTATIONS) {
        for (const scene of SCENES) {
          await captureOne(browser, lang, orientation, scene);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\nAll ${LANGS.length * ORIENTATIONS.length * SCENES.length} screenshots saved to promo/screenshots/`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
