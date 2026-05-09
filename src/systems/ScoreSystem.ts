import type Phaser from "phaser";
import { SCORE } from "@config/score";
import { GameEvents } from "@events/GameEvents";
import type { RoundBreakdown } from "@gametypes/round";

export interface ScoreBreakdown {
  territoryPct: number;
  territoryPoints: number;
  /** Always 0 — kept for UI breakdown compat. */
  speedBonus: number;
  cycleCount: number;
  cyclePoints: number;
  kills: number;
  killPoints: number;
  penalty: number;
  total: number;
}

/** Live score tracking per GDD §2.1.
 * score = totalTerritoryCapturedPct + cycleCount × cyclePoints + kills × killBonus − penalty
 */
export class ScoreSystem {
  /** Cumulative territory % captured across all cycles this run. */
  private totalTerritoryCapturedPct = 0;
  /** Last seen territory % for the current cycle (resets each cycleReset). */
  private lastCyclePct = 0;
  private cycleCount = 0;
  private kills = 0;
  private penalty = 0;
  private liveScore = 0;
  private heroId = -1;
  /** Victim ids already counted this run — prevents double-credit when
   *  multiple TrailCut events fire for the same target. */
  private killedVictims = new Set<number>();

  // Throttle state for emitLiveScore (200ms leading + trailing).
  private lastEmitAt = 0;
  private pendingEmit = false;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(GameEvents.TerritoryUpdate, this.handleTerritoryUpdate, this);
    scene.events.on(GameEvents.TrailCut, this.handleTrailCut, this);
    scene.events.on(GameEvents.RoundEnd, this.handleRoundEnd, this);
    scene.events.on(GameEvents.CycleStart, this.handleCycleStart, this);
  }

  setHeroId(id: number): void {
    this.heroId = id;
  }

  setCycleCount(n: number): void {
    this.cycleCount = n;
    this.emitLiveScore();
  }

  // ---- event handlers ----

  private readonly handleTerritoryUpdate = (payload: { owner: number; percent: number }): void => {
    if (this.heroId < 0 || payload.owner !== this.heroId) return;
    const gain = Math.max(0, payload.percent - this.lastCyclePct);
    this.totalTerritoryCapturedPct += gain;
    this.lastCyclePct = payload.percent;
    this.emitLiveScore();
  };

  private readonly handleTrailCut = (payload: { victim: number; killer: number }): void => {
    if (this.heroId < 0) return;
    if (payload.killer !== this.heroId) return;
    if (payload.victim === payload.killer) return;
    if (this.killedVictims.has(payload.victim)) return;
    this.killedVictims.add(payload.victim);
    this.kills += 1;
    this.emitLiveScore();
  };

  private readonly handleRoundEnd = (_payload: { remainingMs: number }): void => {
    const breakdown = this.buildBreakdown();
    this.liveScore = breakdown.total;
    this.scene.events.emit(GameEvents.ScoreUpdate, breakdown.total);
  };

  private readonly handleCycleStart = (payload: { cycle: number }): void => {
    this.cycleCount = payload.cycle;
    // Reset lastCyclePct so territory gain in new cycle is measured from 0.
    this.lastCyclePct = 0;
    this.emitLiveScore();
  };

  // ---- internal ----

  private emitLiveScore(): void {
    // Always update liveScore so getCurrentScore() is fresh.
    this.liveScore = this.buildBreakdown().total;

    const now = Date.now();
    if (now - this.lastEmitAt >= 200) {
      this.lastEmitAt = now;
      this.pendingEmit = false;
      this.scene.events.emit(GameEvents.ScoreUpdate, this.liveScore);
    } else if (!this.pendingEmit) {
      this.pendingEmit = true;
      const delay = 200 - (now - this.lastEmitAt);
      setTimeout(() => {
        this.pendingEmit = false;
        this.lastEmitAt = Date.now();
        this.scene.events.emit(GameEvents.ScoreUpdate, this.liveScore);
      }, delay);
    }
  }

  private buildBreakdown(): ScoreBreakdown {
    const territoryPoints = Math.round(
      this.totalTerritoryCapturedPct * SCORE.territoryPointsPerPct,
    );
    const cyclePoints = this.cycleCount * SCORE.cyclePoints;
    const killPoints = this.kills * SCORE.killBonus;
    const total = Math.max(0, territoryPoints + cyclePoints + killPoints - this.penalty);

    return {
      territoryPct: this.lastCyclePct,
      territoryPoints,
      speedBonus: 0,
      cycleCount: this.cycleCount,
      cyclePoints,
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

  getBreakdown(_remainingSec = 0): ScoreBreakdown {
    return this.buildBreakdown();
  }

  addPenalty(amount: number): void {
    this.penalty += amount;
    this.emitLiveScore();
  }

  /**
   * Builds a RoundBreakdown compatible with GameOver scene.
   * `remainingSec` and `territoryPct` params kept for API compat — ignored in formula.
   */
  finalize(_remainingSec: number, territoryPct: number, rank = 0, bestNew = false): RoundBreakdown {
    const bd = this.buildBreakdown();
    this.liveScore = bd.total;
    return {
      territoryPct,
      territoryPoints: bd.territoryPoints,
      secondsBonus: 0,
      kills: bd.kills,
      killPoints: bd.killPoints,
      penalty: bd.penalty,
      total: bd.total,
      rank,
      bestNew,
    };
  }

  /** Full reset — call on new run/restart only (not on cycleReset). */
  reset(): void {
    this.totalTerritoryCapturedPct = 0;
    this.lastCyclePct = 0;
    this.cycleCount = 0;
    this.kills = 0;
    this.penalty = 0;
    this.liveScore = 0;
    this.killedVictims.clear();
    this.lastEmitAt = 0;
    this.pendingEmit = false;
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryUpdate, this.handleTerritoryUpdate, this);
    this.scene.events.off(GameEvents.TrailCut, this.handleTrailCut, this);
    this.scene.events.off(GameEvents.RoundEnd, this.handleRoundEnd, this);
    this.scene.events.off(GameEvents.CycleStart, this.handleCycleStart, this);
  }
}
