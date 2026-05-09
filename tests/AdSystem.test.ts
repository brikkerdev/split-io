import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be declared before imports that use them.
const mockSaveData: Record<string, unknown> = {
  version: 1,
  roundsPlayed: 4,
  continueHourlyCount: 0,
  continueHourReset: 0,
};

vi.mock("@systems/SaveManager", () => ({
  saves: {
    get: vi.fn(() => mockSaveData),
    patch: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(mockSaveData, partial);
    }),
  },
}));

let rewardedResult = true;
vi.mock("@sdk/yandex", () => ({
  yandex: {
    showInterstitial: vi.fn(async () => undefined),
    showRewarded: vi.fn(async () => rewardedResult),
  },
}));

vi.mock("@config/ads", () => ({
  ADS: {
    interstitialCooldownMs: 60_000,
    interstitialEveryNthRound: 2,
    skipAfterFirstRound: true,
    continueRetainTerritoryPct: 0.7,
    continuePerRound: 1,
    continuePerHour: 3,
    rewardedDoubleCurrency: true,
  },
}));

import { AdSystem } from "../src/systems/AdSystem";
import { saves } from "../src/systems/SaveManager";
import { yandex } from "../src/sdk/yandex";

describe("AdSystem — interstitial", () => {
  let ad: AdSystem;

  beforeEach(() => {
    ad = new AdSystem();
    mockSaveData.roundsPlayed = 4;
    vi.clearAllMocks();
  });

  it("skips when roundsPlayed <= 1", async () => {
    mockSaveData.roundsPlayed = 1;
    const shown = await ad.showInterstitial();
    expect(shown).toBe(false);
    expect(yandex.showInterstitial).not.toHaveBeenCalled();
  });

  it("skips when not enough rounds have passed", async () => {
    // First call — rounds counter goes 0→1, threshold is 2
    const shown = await ad.showInterstitial();
    expect(shown).toBe(false);
  });

  it("shows after every Nth round and respects cooldown", async () => {
    // Call twice to reach threshold of 2
    await ad.showInterstitial(); // round 1
    const shown = await ad.showInterstitial(); // round 2 — should show
    expect(shown).toBe(true);
    expect(yandex.showInterstitial).toHaveBeenCalledTimes(1);

    // Third call immediately — cooldown not expired
    const blocked = await ad.showInterstitial();
    expect(blocked).toBe(false);
  });
});

describe("AdSystem — continue rewarded", () => {
  let ad: AdSystem;

  beforeEach(() => {
    ad = new AdSystem();
    mockSaveData.continueHourlyCount = 0;
    mockSaveData.continueHourReset = 0;
    mockSaveData.continuesUsedThisRound = 0;
    rewardedResult = true;
    vi.clearAllMocks();
  });

  it("canContinue returns true when bucket is empty", () => {
    expect(ad.canContinue()).toBe(true);
  });

  it("canContinue returns false when hourly limit reached", () => {
    mockSaveData.continueHourlyCount = 3;
    mockSaveData.continueHourReset = Date.now() + 3_600_000;
    expect(ad.canContinue()).toBe(false);
  });

  it("showRewarded continue bumps counter on success", async () => {
    const ok = await ad.showRewarded("continue");
    expect(ok).toBe(true);
    expect(saves.patch).toHaveBeenCalledWith(
      expect.objectContaining({ continueHourlyCount: 1 }),
    );
  });

  it("showRewarded continue returns false when limit reached", async () => {
    mockSaveData.continueHourlyCount = 3;
    mockSaveData.continueHourReset = Date.now() + 3_600_000;
    const ok = await ad.showRewarded("continue");
    expect(ok).toBe(false);
    expect(yandex.showRewarded).not.toHaveBeenCalled();
  });

  it("showRewarded continue returns false when rewarded video declined", async () => {
    rewardedResult = false;
    const ok = await ad.showRewarded("continue");
    expect(ok).toBe(false);
    expect(saves.patch).not.toHaveBeenCalled();
  });

  it("canContinue resets bucket after hour expires", () => {
    mockSaveData.continueHourlyCount = 3;
    mockSaveData.continueHourReset = Date.now() - 1; // expired
    expect(ad.canContinue()).toBe(true);
  });

  it("canContinue returns false when per-round limit reached", () => {
    mockSaveData.continuesUsedThisRound = 1; // continuePerRound = 1
    expect(ad.canContinue()).toBe(false);
  });

  it("resetRoundContinue resets per-round counter", () => {
    mockSaveData.continuesUsedThisRound = 1;
    ad.resetRoundContinue();
    expect(saves.patch).toHaveBeenCalledWith({ continuesUsedThisRound: 0 });
  });

  it("showRewarded doubleCoins delegates directly to yandex", async () => {
    await ad.showRewarded("doubleCoins");
    expect(yandex.showRewarded).toHaveBeenCalledTimes(1);
  });

  it("showRewarded doubleCoins does not touch continueHourlyCount", async () => {
    mockSaveData.continueHourlyCount = 0;
    await ad.showRewarded("doubleCoins");
    expect(saves.patch).not.toHaveBeenCalledWith(
      expect.objectContaining({ continueHourlyCount: expect.anything() }),
    );
  });

  it("showRewarded doubleCoins does not deplete canContinue", async () => {
    await ad.showRewarded("doubleCoins");
    expect(ad.canContinue()).toBe(true);
  });
});
