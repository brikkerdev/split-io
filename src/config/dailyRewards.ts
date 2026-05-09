// 90-day rolling daily-reward schedule.
//
// Cycle structure (matches "2 коин-дня → скин, потом 3 → скин"):
//   • Days 1–2:   coins
//   • Day  3:     skin (cycle reset)
//   • Days 4–6:   coins
//   • Day  7:     skin
//   • Days 8–10:  coins
//   • Day  11:    skin
//   • …repeats every 4 days for the remainder of the 90-day window.
//
// Coin rewards scale with the player's active streak ("огонёк"):
// the longer they show up, the bigger the daily payout.

export type DailyRewardKind = "coins" | "skin";

export interface DailyRewardEntry {
  /** 0-based index in the schedule. */
  dayIndex: number;
  /** 1-based label shown to player. */
  dayNumber: number;
  kind: DailyRewardKind;
  /** Coin payout BEFORE streak multiplier. */
  baseCoins: number;
  /** Skin id awarded on skin-days. Coins-days have undefined. */
  skinId?: string;
  /** Skin-days also include a small coin bonus. */
  bonusCoins?: number;
}

export const DAILY_SCHEDULE_LENGTH = 90;
export const DAILY_STREAK_GRACE_MS = 48 * 60 * 60 * 1000; // miss > 48h ⇒ streak resets
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const DAILY_REWARD_CONFIG = {
  baseCoins: 50,
  /** Each day of streak adds this many coins, capped by streakBonusCap. */
  streakCoinPerDay: 10,
  /** Maximum streak days that grant coin bonus. */
  streakBonusCap: 30,
  /** Multiplier on streak-day-7, -14, -30 ("milestone" days). */
  milestoneMultiplier: 1.5,
  milestones: [7, 14, 30, 60, 90] as readonly number[],
  /** Bonus coins awarded along with skin-days. */
  skinDayBonusCoins: 100,
} as const;

/** Daily-only skin pool, in the order they unlock through the schedule. */
const DAILY_SKIN_POOL: readonly string[] = [
  "daily_coral",
  "daily_aqua",
  "daily_lavender",
  "daily_sun",
  "daily_jade",
  "daily_blossom",
  "daily_sapphire",
  "daily_ember",
  "daily_glacier",
  "daily_forest",
  "daily_orchid",
  "daily_topaz",
  "daily_obsidian",
  "daily_pearl",
  "daily_ruby",
  "daily_lagoon",
  "daily_storm",
  "daily_meadow",
  "daily_neon_void",
  "daily_aurora",
  "daily_inferno",
  "daily_celestial",
  "daily_eclipse",
  "daily_duo_reef",
  "daily_duo_galaxy",
  "daily_duo_candy",
  "daily_duo_phoenix",
];

/**
 * Schedule positions where a skin is granted (0-based).
 * Pattern: 2,6,10,14,18,...  (day 3, then every 4 days).
 */
function isSkinDay(dayIndex: number): boolean {
  if (dayIndex === 2) return true;
  return dayIndex > 2 && (dayIndex - 2) % 4 === 0;
}

/** Index into DAILY_SKIN_POOL for the given dayIndex (assumes isSkinDay). */
function skinIndexForDay(dayIndex: number): number {
  if (dayIndex === 2) return 0;
  return 1 + (dayIndex - 6) / 4;
}

/** Coins reward for a coin-day, gently rising every cycle. */
function coinsForDay(dayIndex: number): number {
  // First three days are tutorial-soft: 30 / 40 / —
  if (dayIndex === 0) return 30;
  if (dayIndex === 1) return 40;
  // Subsequent coin days bump every full cycle.
  const cycleIdx = Math.floor((dayIndex - 3) / 4); // 0,0,0,_,1,1,1,_,...
  const tier = 50 + Math.min(cycleIdx, 20) * 10;
  return tier;
}

/** Returns the schedule entry for a given absolute day index (wraps every 90 days). */
export function getDailyEntry(dayIndex: number): DailyRewardEntry {
  const idx = ((dayIndex % DAILY_SCHEDULE_LENGTH) + DAILY_SCHEDULE_LENGTH) % DAILY_SCHEDULE_LENGTH;
  const dayNumber = idx + 1;
  if (isSkinDay(idx)) {
    const skinIdx = skinIndexForDay(idx) % DAILY_SKIN_POOL.length;
    return {
      dayIndex: idx,
      dayNumber,
      kind: "skin",
      baseCoins: 0,
      skinId: DAILY_SKIN_POOL[skinIdx],
      bonusCoins: DAILY_REWARD_CONFIG.skinDayBonusCoins,
    };
  }
  return {
    dayIndex: idx,
    dayNumber,
    kind: "coins",
    baseCoins: coinsForDay(idx),
  };
}

/** Streak-multiplied coin payout for a given entry. */
export function applyStreakBonus(baseCoins: number, streak: number, dayIndex: number): number {
  if (baseCoins <= 0) return 0;
  const cap = DAILY_REWARD_CONFIG.streakBonusCap;
  const effStreak = Math.max(1, Math.min(streak, cap));
  let total = baseCoins + (effStreak - 1) * DAILY_REWARD_CONFIG.streakCoinPerDay;
  const dayNumber = dayIndex + 1;
  if (DAILY_REWARD_CONFIG.milestones.includes(dayNumber)) {
    total = Math.round(total * DAILY_REWARD_CONFIG.milestoneMultiplier);
  }
  return total;
}

/** Whole list of upcoming N entries from `fromDay` (used by UI strip). */
export function previewSchedule(fromDay: number, count: number): DailyRewardEntry[] {
  const out: DailyRewardEntry[] = [];
  for (let i = 0; i < count; i++) out.push(getDailyEntry(fromDay + i));
  return out;
}

export const DAILY_SKIN_POOL_IDS = DAILY_SKIN_POOL;
