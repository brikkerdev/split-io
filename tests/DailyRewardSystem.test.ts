import { describe, it, expect, vi, beforeEach } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
});

let mockSave = {
  version: 1 as const,
  coins: 0,
  bestScore: 0,
  selectedSkin: "neon_cyan",
  unlockedSkins: ["neon_cyan"] as string[],
  achievements: {} as Record<string, number>,
  dailyClaimedAt: 0,
  dailyDayIndex: 0,
  dailyStreak: 0,
  dailyStreakBest: 0,
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

import { DailyRewardSystem } from "../src/systems/DailyRewardSystem";
import { getDailyEntry, applyStreakBonus, DAILY_SCHEDULE_LENGTH } from "../src/config/dailyRewards";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("DailyRewardSystem", () => {
  let sys: DailyRewardSystem;
  const baseNow = 1_700_000_000_000;

  beforeEach(() => {
    mockSave = {
      ...mockSave,
      coins: 0,
      dailyClaimedAt: 0,
      dailyDayIndex: 0,
      dailyStreak: 0,
      dailyStreakBest: 0,
      unlockedSkins: ["neon_cyan"],
    };
    sys = new DailyRewardSystem();
  });

  it("canClaim returns true when never claimed", () => {
    expect(sys.canClaim(baseNow)).toBe(true);
  });

  it("canClaim returns false immediately after claim", () => {
    sys.claim(baseNow);
    expect(sys.canClaim(baseNow)).toBe(false);
  });

  it("canClaim returns false when less than 24h have passed", () => {
    sys.claim(baseNow);
    expect(sys.canClaim(baseNow + DAY_MS - 1000)).toBe(false);
  });

  it("canClaim returns true after 24h cooldown", () => {
    sys.claim(baseNow);
    expect(sys.canClaim(baseNow + DAY_MS)).toBe(true);
  });

  it("first claim awards day-1 entry and streak = 1", () => {
    const r = sys.claim(baseNow);
    expect(r.success).toBe(true);
    expect(r.streak).toBe(1);
    expect(r.entry?.dayNumber).toBe(1);
    expect(mockSave.dailyDayIndex).toBe(1);
    expect(mockSave.coins).toBe(r.amount);
  });

  it("consecutive claims grow the streak", () => {
    sys.claim(baseNow);
    sys.claim(baseNow + DAY_MS);
    const r3 = sys.claim(baseNow + DAY_MS * 2);
    expect(r3.streak).toBe(3);
    expect(mockSave.dailyStreak).toBe(3);
  });

  it("claim past 48h grace window resets streak to 1", () => {
    sys.claim(baseNow);
    sys.claim(baseNow + DAY_MS);
    expect(mockSave.dailyStreak).toBe(2);
    const later = sys.claim(baseNow + DAY_MS + DAY_MS * 3);
    expect(later.streakResetBefore).toBe(true);
    expect(later.streak).toBe(1);
  });

  it("claim within grace window keeps streak going", () => {
    sys.claim(baseNow);
    const r2 = sys.claim(baseNow + DAY_MS + DAY_MS - 1000); // 47:59:??
    expect(r2.streakResetBefore).toBe(false);
    expect(r2.streak).toBe(2);
  });

  it("double-claim within cooldown fails", () => {
    sys.claim(baseNow);
    const r2 = sys.claim(baseNow + 1000);
    expect(r2.success).toBe(false);
    expect(r2.amount).toBe(0);
  });

  it("day-3 entry is a skin and adds bonus coins", () => {
    // burn through days 1-2
    sys.claim(baseNow);
    sys.claim(baseNow + DAY_MS);
    const r3 = sys.claim(baseNow + DAY_MS * 2);
    expect(r3.entry?.kind).toBe("skin");
    expect(r3.skinId).toBeDefined();
    expect(mockSave.unlockedSkins).toContain(r3.skinId!);
    expect(r3.amount).toBeGreaterThan(0); // bonus coins on skin day
  });

  it("best streak is persisted", () => {
    sys.claim(baseNow);
    sys.claim(baseNow + DAY_MS);
    sys.claim(baseNow + DAY_MS * 2);
    expect(mockSave.dailyStreakBest).toBe(3);
    // miss grace window → streak resets but best persists
    sys.claim(baseNow + DAY_MS * 2 + DAY_MS * 3);
    expect(mockSave.dailyStreak).toBe(1);
    expect(mockSave.dailyStreakBest).toBe(3);
  });

  it("getNextClaimMs returns 0 when never claimed", () => {
    expect(sys.getNextClaimMs(baseNow)).toBe(0);
  });

  it("getNextClaimMs decays correctly", () => {
    sys.claim(baseNow);
    const elapsed = 3600 * 1000;
    expect(sys.getNextClaimMs(baseNow + elapsed)).toBeCloseTo(DAY_MS - elapsed, -3);
  });
});

describe("dailyRewards schedule", () => {
  it("days 1,2 are coins; day 3 is skin", () => {
    expect(getDailyEntry(0).kind).toBe("coins");
    expect(getDailyEntry(1).kind).toBe("coins");
    expect(getDailyEntry(2).kind).toBe("skin");
  });

  it("after day 3, every 4th day is a skin", () => {
    expect(getDailyEntry(3).kind).toBe("coins");
    expect(getDailyEntry(4).kind).toBe("coins");
    expect(getDailyEntry(5).kind).toBe("coins");
    expect(getDailyEntry(6).kind).toBe("skin");
    expect(getDailyEntry(10).kind).toBe("skin");
    expect(getDailyEntry(14).kind).toBe("skin");
  });

  it("schedule wraps every 90 days", () => {
    const a = getDailyEntry(0);
    const b = getDailyEntry(DAILY_SCHEDULE_LENGTH);
    expect(b.dayNumber).toBe(a.dayNumber);
    expect(b.kind).toBe(a.kind);
  });

  it("streak bonus increases linearly within cap", () => {
    const base = 50;
    expect(applyStreakBonus(base, 1, 0)).toBe(50);
    expect(applyStreakBonus(base, 2, 0)).toBe(60);
    expect(applyStreakBonus(base, 5, 0)).toBe(90);
  });

  it("milestone day-7 multiplier kicks in", () => {
    const day7Idx = 6;
    const v = applyStreakBonus(50, 1, day7Idx);
    expect(v).toBe(75); // 50 * 1.5
  });

  it("zero-base entry stays zero regardless of streak", () => {
    expect(applyStreakBonus(0, 30, 6)).toBe(0);
  });
});
