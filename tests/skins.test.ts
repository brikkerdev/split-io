import { describe, it, expect, beforeEach } from "vitest";
import { SKINS } from "../src/config/skins";
import { DEFAULT_SAVE } from "../src/types/save";
import type { SaveV1 } from "../src/types/save";

function buySkin(save: SaveV1, skinId: string): SaveV1 | null {
  const skin = SKINS.find((s) => s.id === skinId);
  if (!skin) return null;
  if (save.unlockedSkins.includes(skinId)) return null;
  if (save.coins < skin.cost) return null;
  return {
    ...save,
    coins: save.coins - skin.cost,
    unlockedSkins: [...save.unlockedSkins, skinId],
    selectedSkin: skinId,
  };
}

function selectSkin(save: SaveV1, skinId: string): SaveV1 | null {
  if (!save.unlockedSkins.includes(skinId)) return null;
  return { ...save, selectedSkin: skinId };
}

describe("Skins logic", () => {
  let save: SaveV1;

  beforeEach(() => {
    save = { ...DEFAULT_SAVE, unlockedSkins: [...DEFAULT_SAVE.unlockedSkins] };
  });

  it("default skin is neon_cyan and is unlocked", () => {
    expect(save.selectedSkin).toBe("neon_cyan");
    expect(save.unlockedSkins).toContain("neon_cyan");
  });

  it("cannot buy skin with insufficient coins", () => {
    const result = buySkin(save, "neon_pink"); // costs 200, save has 0
    expect(result).toBeNull();
  });

  it("buys skin when coins are sufficient", () => {
    save = { ...save, coins: 200 };
    const result = buySkin(save, "neon_pink");
    expect(result).not.toBeNull();
    expect(result!.coins).toBe(0);
    expect(result!.unlockedSkins).toContain("neon_pink");
    expect(result!.selectedSkin).toBe("neon_pink");
  });

  it("cannot buy already-owned skin", () => {
    save = { ...save, coins: 999 };
    const result = buySkin(save, "neon_cyan");
    expect(result).toBeNull();
  });

  it("selects owned skin", () => {
    save = { ...save, unlockedSkins: ["neon_cyan", "neon_pink"] };
    const result = selectSkin(save, "neon_pink");
    expect(result!.selectedSkin).toBe("neon_pink");
  });

  it("cannot select locked skin", () => {
    const result = selectSkin(save, "neon_pink");
    expect(result).toBeNull();
  });

  it("SKINS has shop, daily and dual-tone tiers", () => {
    const shop = SKINS.filter((s) => !s.dailyOnly);
    const daily = SKINS.filter((s) => s.dailyOnly);
    const duo = SKINS.filter((s) => s.fillSecondary !== undefined);
    expect(shop.length).toBeGreaterThanOrEqual(12);
    expect(daily.length).toBeGreaterThanOrEqual(20);
    expect(duo.length).toBeGreaterThanOrEqual(3);
  });

  it("every skin has a pattern id", () => {
    for (const s of SKINS) {
      expect(typeof s.pattern).toBe("string");
      expect(s.pattern.length).toBeGreaterThan(0);
    }
  });

  it("daily-only skins all have cost 0", () => {
    for (const s of SKINS) {
      if (s.dailyOnly) expect(s.cost).toBe(0);
    }
  });

  it("free skin has cost 0", () => {
    const free = SKINS.find((s) => s.cost === 0);
    expect(free).toBeDefined();
    expect(free!.id).toBe("neon_cyan");
  });

  it("buying expensive skin deducts correct coins", () => {
    const gold = SKINS.find((s) => s.id === "neon_gold")!;
    save = { ...save, coins: gold.cost, unlockedSkins: ["neon_cyan"] };
    const result = buySkin(save, "neon_gold");
    expect(result!.coins).toBe(0);
  });
});
