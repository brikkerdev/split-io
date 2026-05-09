import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@config/economy", () => ({
  ECONOMY: {
    startingCoins: 0,
    dailyRewardCoins: 50,
    dailyRewardCooldownMs: 86400000,
    rewardedDoubleMult: 2,
    rewardMultiplier: 1,
    costGrowthRate: 1.25,
    coinsPerTerritoryStepPct: 2,
    coinsPerKill: 1,
  },
}));

vi.mock("@events/GameEvents", () => ({
  GameEvents: {
    TerritoryCaptured: "territory:captured",
    TrailCut: "trail:cut",
    CoinEarned: "coin:earned",
    CoinTotalChanged: "coin:total",
  },
}));

import { Economy } from "../src/systems/Economy";
import { CoinSystem } from "../src/systems/CoinSystem";
import type { CoinEarnedPayload, CoinTotalPayload } from "../src/types/events";

interface FakeScene {
  events: {
    on: (key: string, cb: (p: unknown) => void) => void;
    off: (key: string) => void;
    emit: (key: string, payload: unknown) => void;
    _emit: (key: string, payload: unknown) => void;
    _emitted: Array<{ key: string; payload: unknown }>;
  };
}

function makeScene(): FakeScene {
  const listeners: Record<string, Array<(p: unknown) => void>> = {};
  const emitted: Array<{ key: string; payload: unknown }> = [];

  return {
    events: {
      on: vi.fn((key: string, cb: (p: unknown) => void) => {
        if (!listeners[key]) listeners[key] = [];
        listeners[key]!.push(cb);
      }),
      off: vi.fn(),
      emit: vi.fn((key: string, payload: unknown) => {
        emitted.push({ key, payload });
      }),
      _emit: (key: string, payload: unknown) => {
        for (const cb of listeners[key] ?? []) cb(payload);
      },
      _emitted: emitted,
    },
  };
}

function makeEconomy(): Economy {
  return new Economy({ startingCoins: 0, rewardMultiplier: 1, costGrowthRate: 1.25 });
}

describe("CoinSystem", () => {
  let scene: FakeScene;
  let economy: Economy;
  let coinSys: CoinSystem;

  beforeEach(() => {
    scene = makeScene();
    economy = makeEconomy();
    // CoinSystem accepts any object with the right events shape.
    coinSys = new CoinSystem(scene as unknown as import("phaser").Scene, economy);
    coinSys.setHeroId(1);
    coinSys.reset();
  });

  it("0→3.5% territory gives 1 coin (2% threshold)", () => {
    scene.events._emit("territory:captured", { ownerId: 1, cells: 100, pct: 3.5 });
    expect(economy.getCoins()).toBe(1);
    const earned = scene.events._emitted.filter((e) => e.key === "coin:earned");
    expect(earned).toHaveLength(1);
    expect((earned[0]!.payload as CoinEarnedPayload).amount).toBe(1);
    expect((earned[0]!.payload as CoinEarnedPayload).reason).toBe("territory");
  });

  it("0→5.5% territory gives 2 coins (crosses 2% and 4% thresholds)", () => {
    scene.events._emit("territory:captured", { ownerId: 1, cells: 200, pct: 5.5 });
    expect(economy.getCoins()).toBe(2);
    const earned = scene.events._emitted.filter((e) => e.key === "coin:earned");
    expect(earned).toHaveLength(1);
    expect((earned[0]!.payload as CoinEarnedPayload).amount).toBe(2);
  });

  it("multiple captures with running total only pay for newly crossed thresholds", () => {
    // pct is the running total of owned territory, not a delta.
    scene.events._emit("territory:captured", { ownerId: 1, cells: 50, pct: 1.5 });
    expect(economy.getCoins()).toBe(0);
    scene.events._emit("territory:captured", { ownerId: 1, cells: 50, pct: 2.1 });
    // crossed 2% threshold → 1 coin
    expect(economy.getCoins()).toBe(1);
    scene.events._emit("territory:captured", { ownerId: 1, cells: 100, pct: 4.0 });
    // crossed 4% threshold → 1 more coin
    expect(economy.getCoins()).toBe(2);
  });

  it("does not pay again when total decreases then re-grows under previous max", () => {
    scene.events._emit("territory:captured", { ownerId: 1, cells: 200, pct: 5.5 });
    expect(economy.getCoins()).toBe(2); // crosses 2% and 4%
    // simulate territory loss → re-capture under previous max
    scene.events._emit("territory:captured", { ownerId: 1, cells: 50, pct: 4.5 });
    expect(economy.getCoins()).toBe(2); // no double-pay
    scene.events._emit("territory:captured", { ownerId: 1, cells: 100, pct: 6.1 });
    expect(economy.getCoins()).toBe(3); // crosses new 6% threshold once
  });

  it("repeated capture events at the same pct never re-award", () => {
    scene.events._emit("territory:captured", { ownerId: 1, cells: 200, pct: 5.5 });
    expect(economy.getCoins()).toBe(2);
    scene.events._emit("territory:captured", { ownerId: 1, cells: 0, pct: 5.5 });
    expect(economy.getCoins()).toBe(2);
  });

  it("territory capture from non-hero does not award coins", () => {
    scene.events._emit("territory:captured", { ownerId: 99, cells: 200, pct: 10 });
    expect(economy.getCoins()).toBe(0);
  });

  it("kill by hero awards 1 coin", () => {
    scene.events._emit("trail:cut", { killer: 1, victim: 42 });
    expect(economy.getCoins()).toBe(1);
    const earned = scene.events._emitted.filter((e) => e.key === "coin:earned");
    expect(earned).toHaveLength(1);
    expect((earned[0]!.payload as CoinEarnedPayload).reason).toBe("kill");
    expect((earned[0]!.payload as CoinEarnedPayload).amount).toBe(1);
  });

  it("kill where hero is victim does not award coins", () => {
    scene.events._emit("trail:cut", { killer: 42, victim: 1 });
    expect(economy.getCoins()).toBe(0);
  });

  it("kill where neither is hero does not award coins", () => {
    scene.events._emit("trail:cut", { killer: 10, victim: 20 });
    expect(economy.getCoins()).toBe(0);
  });

  it("emits CoinTotalChanged after each award", () => {
    scene.events._emit("trail:cut", { killer: 1, victim: 42 });
    const totals = scene.events._emitted.filter((e) => e.key === "coin:total");
    expect(totals).toHaveLength(1);
    expect((totals[0]!.payload as CoinTotalPayload).total).toBe(1);
  });

  it("reset() clears max-pct so thresholds restart", () => {
    scene.events._emit("territory:captured", { ownerId: 1, cells: 50, pct: 1.9 });
    expect(economy.getCoins()).toBe(0);
    coinSys.reset();
    scene.events._emit("territory:captured", { ownerId: 1, cells: 50, pct: 1.9 });
    // Still below 2% since reset, so still 0
    expect(economy.getCoins()).toBe(0);
    scene.events._emit("territory:captured", { ownerId: 1, cells: 50, pct: 2.1 });
    // Crosses 2% → 1 coin
    expect(economy.getCoins()).toBe(1);
  });
});
