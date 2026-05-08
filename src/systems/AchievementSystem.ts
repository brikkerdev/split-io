import { ACHIEVEMENTS } from "@config/achievements";
import type { AchievementId } from "@config/achievements";
import { GameEvents } from "@events/GameEvents";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import type { RoundBreakdown } from "@gametypes/round";

interface TerritoryUpdatePayload {
  owner: number;
  percent: number;
}

interface TrailCutPayload {
  victim: number;
  killer: number;
}

interface GhostDestroyedPayload {
  reason: "captured" | "killed" | "fallback";
}

export const AchievementSystemEvents = {
  AchievementUnlocked: "achievement:unlocked",
} as const;

export interface AchievementUnlockedPayload {
  id: AchievementId;
  nameKey: string;
  rewardCoins: number;
}

// Minimum survival seconds for the "survive_round" achievement
const SURVIVE_MIN_SEC = 60;

export class AchievementSystem {
  private scene: Phaser.Scene;
  private heroId: number;

  // Per-round trackers
  private roundKills = 0;
  private ghostActiveKills = 0;
  private ghostCurrentlyActive = false;
  private roundStartMs = 0;

  // Cross-round tracker for top1 streak
  private top1Streak = 0;

  private boundOnTerritoryUpdate: (payload: TerritoryUpdatePayload) => void;
  private boundOnTrailCut: (payload: TrailCutPayload) => void;
  private boundOnGhostDestroyed: (payload: GhostDestroyedPayload) => void;
  private boundOnGhostSpawned: () => void;
  private boundOnRoundEnd: (breakdown: RoundBreakdown) => void;

  constructor(scene: Phaser.Scene, heroId: number) {
    this.scene = scene;
    this.heroId = heroId;

    this.boundOnTerritoryUpdate = this.onTerritoryUpdate.bind(this);
    this.boundOnTrailCut = this.onTrailCut.bind(this);
    this.boundOnGhostDestroyed = this.onGhostDestroyed.bind(this);
    this.boundOnGhostSpawned = this.onGhostSpawned.bind(this);
    this.boundOnRoundEnd = this.onRoundEnd.bind(this);

    this.scene.events.on(GameEvents.TerritoryUpdate, this.boundOnTerritoryUpdate);
    this.scene.events.on(GameEvents.TrailCut, this.boundOnTrailCut);
    this.scene.events.on(GameEvents.GhostDestroyed, this.boundOnGhostDestroyed);
    this.scene.events.on(GameEvents.GhostSpawned, this.boundOnGhostSpawned);
    this.scene.events.on(GameEvents.RoundEnd, this.boundOnRoundEnd);
  }

  resetRound(): void {
    this.roundKills = 0;
    this.ghostActiveKills = 0;
    this.ghostCurrentlyActive = false;
    this.roundStartMs = Date.now();
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryUpdate, this.boundOnTerritoryUpdate);
    this.scene.events.off(GameEvents.TrailCut, this.boundOnTrailCut);
    this.scene.events.off(GameEvents.GhostDestroyed, this.boundOnGhostDestroyed);
    this.scene.events.off(GameEvents.GhostSpawned, this.boundOnGhostSpawned);
    this.scene.events.off(GameEvents.RoundEnd, this.boundOnRoundEnd);
  }

  // ── Event handlers ────────────────────────────────────────

  private onTerritoryUpdate(payload: TerritoryUpdatePayload): void {
    if (payload.owner !== this.heroId) return;
    if (payload.percent >= 5) this.tryUnlock("first_5pct");
    if (payload.percent >= 50) this.tryUnlock("capture_50pct");
    if (payload.percent >= 100) this.tryUnlock("capture_100pct");
  }

  private onTrailCut(payload: TrailCutPayload): void {
    if (payload.killer !== this.heroId) return;
    this.roundKills += 1;
    if (this.ghostCurrentlyActive) {
      this.ghostActiveKills += 1;
    }
    if (this.ghostActiveKills >= 1) this.tryUnlock("kill_with_ghost");
    if (this.roundKills >= 10) this.tryUnlock("ten_kills_round");
  }

  private onGhostSpawned(): void {
    this.ghostCurrentlyActive = true;
  }

  private onGhostDestroyed(_payload: GhostDestroyedPayload): void {
    this.ghostCurrentlyActive = false;
  }

  private onRoundEnd(breakdown: RoundBreakdown): void {
    const elapsedSec = (Date.now() - this.roundStartMs) / 1000;
    if (elapsedSec >= SURVIVE_MIN_SEC) {
      this.tryUnlock("survive_round");
    }

    const isTop1 = breakdown.rank === 1;
    if (isTop1) {
      this.top1Streak += 1;
    } else {
      this.top1Streak = 0;
    }

    if (this.top1Streak >= 3) this.tryUnlock("top1_streak3");
  }

  // ── Unlock logic ──────────────────────────────────────────

  tryUnlock(id: AchievementId): void {
    const save = saves.get<SaveV1>();
    if (save.achievements[id]) return; // idempotent

    const def = ACHIEVEMENTS.list.find((a) => a.id === id);
    if (!def) return;

    saves.patch({
      achievements: { ...save.achievements, [id]: Date.now() },
      coins: save.coins + def.rewardCoins,
    });

    const payload: AchievementUnlockedPayload = {
      id,
      nameKey: def.nameKey,
      rewardCoins: def.rewardCoins,
    };
    this.scene.game.events.emit(AchievementSystemEvents.AchievementUnlocked, payload);
  }
}
