import type Phaser from "phaser";
import { SCORE } from "@config/score";
import { GameEvents } from "@events/GameEvents";
import type { RoundBreakdown } from "@gametypes/round";

export interface ScoreBreakdown {
  territoryPct: number;
  territoryPoints: number;
  speedBonus: number;
  kills: number;
  killPoints: number;
  penalty: number;
  total: number;
}

/** Live score, territory tracking, kill bonus, end-of-round breakdown. */
export class ScoreSystem {
  private currentPct = 0;
  private kills = 0;
  private penalty = 0;
  private liveScore = 0;
  private heroId = -1;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(GameEvents.TerritoryUpdate, this.handleTerritoryUpdate, this);
    scene.events.on(GameEvents.TrailCut, this.handleTrailCut, this);
    scene.events.on(GameEvents.RoundEnd, this.handleRoundEnd, this);
  }

  setHeroId(id: number): void {
    this.heroId = id;
  }

  // ---- event handlers ----

  private readonly handleTerritoryUpdate = (payload: { owner: number; percent: number }): void => {
    if (this.heroId < 0 || payload.owner !== this.heroId) return;
    this.currentPct = payload.percent;
    this.emitLiveScore();
  };

  private readonly handleTrailCut = (payload: { victim: number; killer: number }): void => {
    if (this.heroId < 0 || payload.killer !== this.heroId) return;
    this.kills += 1;
    this.emitLiveScore();
  };

  private readonly handleRoundEnd = (payload: { remainingMs: number }): void => {
    const remainingSec = payload.remainingMs / 1000;
    const breakdown = this.buildBreakdown(remainingSec, this.currentPct);
    this.liveScore = breakdown.total;
    this.scene.events.emit(GameEvents.ScoreUpdate, breakdown.total);
  };

  // ---- internal ----

  private emitLiveScore(): void {
    const live =
      this.currentPct * SCORE.territoryWeight +
      this.kills * SCORE.killBonus -
      this.penalty;
    this.liveScore = Math.max(0, live);
    this.scene.events.emit(GameEvents.ScoreUpdate, this.liveScore);
  }

  private buildBreakdown(remainingSec: number, territoryPct: number): ScoreBreakdown {
    const territoryPoints = Math.round(territoryPct * SCORE.territoryWeight);
    const speedBonus = Math.round(remainingSec * SCORE.secondWeight);
    const killPoints = this.kills * SCORE.killBonus;
    const total = Math.max(0, territoryPoints + speedBonus + killPoints - this.penalty);

    return {
      territoryPct,
      territoryPoints,
      speedBonus,
      kills: this.kills,
      killPoints,
      penalty: this.penalty,
      total,
    };
  }

  // ---- public API ----

  getCurrentScore(): number {
    return this.liveScore;
  }

  getBreakdown(remainingSec = 0): ScoreBreakdown {
    return this.buildBreakdown(remainingSec, this.currentPct);
  }

  addPenalty(amount: number): void {
    this.penalty += amount;
    this.emitLiveScore();
  }

  /**
   * Builds a RoundBreakdown compatible with GameOver scene.
   * Call from GameScene on round end with final values.
   */
  finalize(remainingSec: number, territoryPct: number, rank = 0, bestNew = false): RoundBreakdown {
    const bd = this.buildBreakdown(remainingSec, territoryPct);
    this.liveScore = bd.total;
    return {
      territoryPct: bd.territoryPct,
      territoryPoints: bd.territoryPoints,
      secondsBonus: bd.speedBonus,
      kills: bd.kills,
      killPoints: bd.killPoints,
      penalty: bd.penalty,
      total: bd.total,
      rank,
      bestNew,
    };
  }

  reset(): void {
    this.currentPct = 0;
    this.kills = 0;
    this.penalty = 0;
    this.liveScore = 0;
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryUpdate, this.handleTerritoryUpdate, this);
    this.scene.events.off(GameEvents.TrailCut, this.handleTrailCut, this);
    this.scene.events.off(GameEvents.RoundEnd, this.handleRoundEnd, this);
  }
}
