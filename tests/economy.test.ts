import { describe, expect, it } from "vitest";
import { Economy } from "../src/systems/Economy";

const config = { startingCoins: 100, rewardMultiplier: 1, costGrowthRate: 1.5 };

describe("Economy", () => {
  it("starts with configured coins", () => {
    const e = new Economy(config);
    expect(e.getCoins()).toBe(100);
  });

  it("adds with multiplier", () => {
    const e = new Economy({ ...config, rewardMultiplier: 2 });
    e.add(10);
    expect(e.getCoins()).toBe(120);
  });

  it("spends if enough", () => {
    const e = new Economy(config);
    expect(e.spend(50)).toBe(true);
    expect(e.getCoins()).toBe(50);
  });

  it("refuses spend if not enough", () => {
    const e = new Economy(config);
    expect(e.spend(200)).toBe(false);
    expect(e.getCoins()).toBe(100);
  });

  it("scales cost by level", () => {
    const e = new Economy(config);
    expect(e.costAtLevel(100, 0)).toBe(100);
    expect(e.costAtLevel(100, 1)).toBe(150);
    expect(e.costAtLevel(100, 2)).toBe(225);
  });

  it("rejects negative add", () => {
    const e = new Economy(config);
    expect(() => e.add(-5)).toThrow();
  });
});
