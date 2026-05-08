import { ADS } from "@config/ads";
import { saves } from "./SaveManager";
import { yandex } from "@sdk/yandex";
import type { SaveData } from "./SaveManager";

interface AdSaveSlot extends SaveData {
  version: number;
  roundsPlayed: number;
  continueHourlyCount: number;
  continueHourReset: number;
  continuesUsedThisRound: number;
}

export type RewardType = "continue" | "doubleCoins";

export class AdSystem {
  private lastInterstitialAt = 0;
  private roundsSinceInterstitial = 0;

  // ---- Interstitial ----

  async showInterstitial(): Promise<boolean> {
    const save = saves.get<AdSaveSlot>();

    if (ADS.skipAfterFirstRound && save.roundsPlayed <= 1) return false;

    this.roundsSinceInterstitial += 1;
    if (this.roundsSinceInterstitial < ADS.interstitialEveryNthRound) return false;

    const now = Date.now();
    if (now - this.lastInterstitialAt < ADS.interstitialCooldownMs) return false;

    this.lastInterstitialAt = now;
    this.roundsSinceInterstitial = 0;

    await yandex.showInterstitial();
    return true;
  }

  // ---- Rewarded ----

  async showRewarded(rewardType: RewardType): Promise<boolean> {
    if (rewardType === "continue") {
      return this.showContinue();
    }
    return yandex.showRewarded();
  }

  canContinue(): boolean {
    const save = saves.get<AdSaveSlot>();
    const now = Date.now();

    const usedThisRound: number = save.continuesUsedThisRound ?? 0;
    if (usedThisRound >= ADS.continuePerRound) return false;

    const hourReset: number = save.continueHourReset ?? 0;
    const count: number = save.continueHourlyCount ?? 0;

    if (now > hourReset) return true;
    return count < ADS.continuePerHour;
  }

  /** Call at the start of each new round to reset the per-round counter. */
  resetRoundContinue(): void {
    saves.patch({ continuesUsedThisRound: 0 });
  }

  // ---- Internal ----

  private async showContinue(): Promise<boolean> {
    if (!this.canContinue()) return false;

    const ok = await yandex.showRewarded();
    if (!ok) return false;

    this.bumpContinueCounter();
    this.bumpRoundContinue();
    return true;
  }

  private bumpRoundContinue(): void {
    const save = saves.get<AdSaveSlot>();
    const used: number = save.continuesUsedThisRound ?? 0;
    saves.patch({ continuesUsedThisRound: used + 1 });
  }

  private bumpContinueCounter(): void {
    const save = saves.get<AdSaveSlot>();
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    const hourReset: number = save.continueHourReset ?? 0;
    const count: number = save.continueHourlyCount ?? 0;

    if (now > hourReset) {
      saves.patch({ continueHourlyCount: 1, continueHourReset: now + hourMs });
    } else {
      saves.patch({ continueHourlyCount: count + 1 });
    }
  }
}
