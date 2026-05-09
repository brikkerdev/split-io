import {
  applyStreakBonus,
  DAILY_COOLDOWN_MS,
  DAILY_STREAK_GRACE_MS,
  getDailyEntry,
  previewSchedule,
  type DailyRewardEntry,
} from "@config/dailyRewards";
import { saves } from "@systems/SaveManager";
import { SKINS } from "@config/skins";
import type { SaveV1 } from "@/types/save";

/** Coin compensation when a daily skin is already owned. */
const OWNED_SKIN_COIN_COMP = 120;

/** Replace skin entries the player already owns with an equivalent coin reward. */
function substituteOwnedSkins(
  entry: DailyRewardEntry,
  owned: ReadonlySet<string>,
): DailyRewardEntry {
  if (entry.kind !== "skin" || !entry.skinId) return entry;
  if (!owned.has(entry.skinId)) return entry;
  return {
    dayIndex: entry.dayIndex,
    dayNumber: entry.dayNumber,
    kind: "coins",
    baseCoins: (entry.bonusCoins ?? 0) + OWNED_SKIN_COIN_COMP,
  };
}

export interface ClaimResult {
  success: boolean;
  /** Coins added to wallet (after streak bonus). 0 on failure. */
  amount: number;
  /** Skin id awarded if this was a skin-day. */
  skinId?: string;
  /** Streak after applying this claim (0 on failure). */
  streak: number;
  /** True if streak was reset by this claim (missed grace window). */
  streakResetBefore: boolean;
  /** The schedule entry that was consumed. */
  entry?: DailyRewardEntry;
}

export interface DailyStatus {
  canClaim: boolean;
  /** 0 if never claimed; otherwise ms remaining to next 24h gate. */
  nextClaimMs: number;
  /** Active streak (post-grace logic). 0 if expired. */
  streak: number;
  bestStreak: number;
  /** The entry that the next claim will award. */
  nextEntry: DailyRewardEntry;
  /**
   * Entry to show in the "today" slot of the UI. When the player can claim
   * (or has never claimed / streak just expired), equals nextEntry. During
   * the 24h cooldown this is the entry that was just claimed, so the
   * displayed day number stays aligned with the streak counter.
   */
  currentEntry: DailyRewardEntry;
  /** A 7-entry preview starting at nextEntry. */
  preview: DailyRewardEntry[];
  /** True if streak has expired due to missed grace window. */
  streakExpired: boolean;
}

export class DailyRewardSystem {
  // ── Status ──────────────────────────────────────────────

  getStatus(nowMs: number): DailyStatus {
    const save = this.safeSave();
    if (!save) {
      const entry = getDailyEntry(0);
      return {
        canClaim: false,
        nextClaimMs: 0,
        streak: 0,
        bestStreak: 0,
        nextEntry: entry,
        currentEntry: entry,
        preview: previewSchedule(0, 7),
        streakExpired: false,
      };
    }
    const last = save.dailyClaimedAt ?? 0;
    const sinceLast = nowMs - last;
    const canClaim = last === 0 || sinceLast >= DAILY_COOLDOWN_MS;
    const streakExpired = last !== 0 && sinceLast > DAILY_STREAK_GRACE_MS;
    const liveStreak = streakExpired ? 0 : (save.dailyStreak ?? 0);
    // Streak reset → schedule rewinds back to day 1, so the player starts
    // earning the soft early-day rewards again.
    const dayIdx = streakExpired ? 0 : (save.dailyDayIndex ?? 0);
    const owned = new Set(save.unlockedSkins ?? []);

    const nextEntry = substituteOwnedSkins(getDailyEntry(dayIdx), owned);
    // During cooldown the schedule cursor (`dayIdx`) is one ahead of what was
    // just claimed; the "today" card should reflect the just-claimed entry so
    // that the day number matches the streak the player sees on the flame.
    const currentEntry =
      canClaim || dayIdx === 0
        ? nextEntry
        : substituteOwnedSkins(getDailyEntry(dayIdx - 1), owned);

    return {
      canClaim,
      nextClaimMs: last === 0 ? 0 : Math.max(0, last + DAILY_COOLDOWN_MS - nowMs),
      streak: liveStreak,
      bestStreak: save.dailyStreakBest ?? 0,
      nextEntry,
      currentEntry,
      preview: previewSchedule(dayIdx, 7).map((e) => substituteOwnedSkins(e, owned)),
      streakExpired,
    };
  }

  canClaim(nowMs: number): boolean {
    return this.getStatus(nowMs).canClaim;
  }

  getNextClaimMs(nowMs: number): number {
    return this.getStatus(nowMs).nextClaimMs;
  }

  // ── Claim ──────────────────────────────────────────────

  claim(nowMs: number): ClaimResult {
    const save = this.safeSave();
    if (!save) return this.failure();

    const last = save.dailyClaimedAt ?? 0;
    if (last !== 0 && nowMs - last < DAILY_COOLDOWN_MS) {
      return this.failure();
    }

    // Streak update: previous streak + 1, unless grace window was exceeded.
    const prevStreak = save.dailyStreak ?? 0;
    const sinceLast = nowMs - last;
    const streakExpired = last !== 0 && sinceLast > DAILY_STREAK_GRACE_MS;
    const newStreak = streakExpired || last === 0 ? 1 : prevStreak + 1;

    // Streak reset → restart the schedule so the player walks the early-day
    // (small) rewards again instead of skipping ahead through time.
    const dayIdx = streakExpired ? 0 : (save.dailyDayIndex ?? 0);
    const ownedSet = new Set(save.unlockedSkins ?? []);
    const rawEntry = getDailyEntry(dayIdx);
    const entry = substituteOwnedSkins(rawEntry, ownedSet);

    let coinsToAdd = 0;
    let skinId: string | undefined;
    let unlocked = save.unlockedSkins ?? [];

    if (entry.kind === "coins") {
      coinsToAdd = applyStreakBonus(entry.baseCoins, newStreak, dayIdx);
    } else {
      skinId = entry.skinId;
      coinsToAdd = applyStreakBonus(entry.bonusCoins ?? 0, newStreak, dayIdx);
      // Validate skin exists in catalog; if not, drop silently.
      if (skinId && !SKINS.some((s) => s.id === skinId)) {
        skinId = undefined;
      } else if (skinId) {
        unlocked = [...unlocked, skinId];
      }
    }

    const bestStreak = Math.max(save.dailyStreakBest ?? 0, newStreak);

    saves.patch({
      coins: (save.coins ?? 0) + coinsToAdd,
      dailyClaimedAt: nowMs,
      dailyDayIndex: dayIdx + 1, // schedule wraps inside getDailyEntry()
      dailyStreak: newStreak,
      dailyStreakBest: bestStreak,
      unlockedSkins: unlocked,
    });

    return {
      success: true,
      amount: coinsToAdd,
      skinId,
      streak: newStreak,
      streakResetBefore: streakExpired,
      entry,
    };
  }

  // ── Helpers ────────────────────────────────────────────

  private safeSave(): SaveV1 | null {
    try { return saves.get<SaveV1>(); } catch { return null; }
  }

  private failure(): ClaimResult {
    return {
      success: false,
      amount: 0,
      streak: 0,
      streakResetBefore: false,
    };
  }
}
