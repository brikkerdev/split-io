import { describe, it, expect, vi, beforeEach } from "vitest";
import { ECONOMY } from "../src/config/economy";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
});

// Mock SaveManager
let mockSave = {
  version: 1 as const,
  coins: 0,
  bestScore: 0,
  selectedSkin: "neon_cyan",
  unlockedSkins: ["neon_cyan"],
  achievements: {} as Record<string, number>,
  dailyClaimedAt: 0,
  roundsPlayed: 0,
  continuesUsedThisRound: 0,
  settings: {
    musicVolume: 0.6,
    sfxVolume: 1.0,
    controlScheme: "swipe" as const,
    lang: null,
  },
};

vi.mock("@systems/SaveManager", () => ({
  saves: {
    get: () => mockSave,
    patch: (patch: Partial<typeof mockSave>) => {
      mockSave = { ...mockSave, ...patch };
    },
  },
}));

vi.mock("@config/economy", () => ({
  ECONOMY: {
    startingCoins: 0,
    dailyRewardCoins: 50,
    dailyRewardCooldownMs: 24 * 60 * 60 * 1000,
    rewardedDoubleMult: 2,
    rewardMultiplier: 1,
    costGrowthRate: 1.25,
  },
}));

import { DailyRewardSystem } from "../src/systems/DailyRewardSystem";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("DailyRewardSystem", () => {
  let sys: DailyRewardSystem;
  const baseNow = 1_700_000_000_000;

  beforeEach(() => {
    mockSave = {
      ...mockSave,
      coins: 0,
      dailyClaimedAt: 0,
    };
    sys = new DailyRewardSystem();
  });

  it("canClaim returns true when lastDailyClaimMs is 0 (never claimed)", () => {
    expect(sys.canClaim(baseNow)).toBe(true);
  });

  it("canClaim returns false immediately after claim", () => {
    sys.claim(baseNow);
    expect(sys.canClaim(baseNow)).toBe(false);
  });

  it("canClaim returns false when less than 24h have passed", () => {
    mockSave.dailyClaimedAt = baseNow;
    const almostDay = baseNow + DAY_MS - 1000;
    expect(sys.canClaim(almostDay)).toBe(false);
  });

  it("canClaim returns true after exactly 24h cooldown", () => {
    mockSave.dailyClaimedAt = baseNow;
    expect(sys.canClaim(baseNow + DAY_MS)).toBe(true);
  });

  it("claim returns success=true and amount=50 when eligible", () => {
    const result = sys.claim(baseNow);
    expect(result.success).toBe(true);
    expect(result.amount).toBe(ECONOMY.dailyRewardCoins);
  });

  it("claim adds coins to save", () => {
    mockSave.coins = 100;
    sys.claim(baseNow);
    expect(mockSave.coins).toBe(150);
  });

  it("claim returns success=false on double-claim", () => {
    sys.claim(baseNow);
    const second = sys.claim(baseNow + 1000);
    expect(second.success).toBe(false);
    expect(second.amount).toBe(0);
  });

  it("claim does not add coins on double-claim", () => {
    mockSave.coins = 0;
    sys.claim(baseNow);
    sys.claim(baseNow + 100);
    expect(mockSave.coins).toBe(50);
  });

  it("getNextClaimMs returns 0 when never claimed", () => {
    expect(sys.getNextClaimMs(baseNow)).toBe(0);
  });

  it("getNextClaimMs returns remaining time after claim", () => {
    sys.claim(baseNow);
    const elapsed = 3600 * 1000;
    const remaining = sys.getNextClaimMs(baseNow + elapsed);
    expect(remaining).toBeCloseTo(DAY_MS - elapsed, -3);
  });
});
