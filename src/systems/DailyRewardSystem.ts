import { ECONOMY } from "@config/economy";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";

export interface ClaimResult {
  success: boolean;
  amount: number;
}

export class DailyRewardSystem {
  canClaim(nowMs: number): boolean {
    let save: SaveV1;
    try {
      save = saves.get<SaveV1>();
    } catch {
      return false;
    }
    const last = save.dailyClaimedAt ?? 0;
    return last === 0 || nowMs - last >= ECONOMY.dailyRewardCooldownMs;
  }

  claim(nowMs: number): ClaimResult {
    if (!this.canClaim(nowMs)) {
      return { success: false, amount: 0 };
    }

    let save: SaveV1;
    try {
      save = saves.get<SaveV1>();
    } catch {
      return { success: false, amount: 0 };
    }

    const amount = ECONOMY.dailyRewardCoins;
    saves.patch({
      coins: (save.coins ?? 0) + amount,
      dailyClaimedAt: nowMs,
    });

    return { success: true, amount };
  }

  getNextClaimMs(nowMs: number): number {
    let save: SaveV1;
    try {
      save = saves.get<SaveV1>();
    } catch {
      return 0;
    }
    const last = save.dailyClaimedAt ?? 0;
    if (last === 0) return 0;
    return last + ECONOMY.dailyRewardCooldownMs - nowMs;
  }
}
