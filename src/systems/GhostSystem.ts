import type Phaser from "phaser";
import { GHOST } from "@config/ghost";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { BALANCE } from "@config/balance";
import { RENDER } from "@config/render";
import { GameEvents } from "@events/GameEvents";
import { Ghost } from "@entities/Ghost";
import type { Hero } from "@entities/Hero";
import type { TrailSystem } from "./TrailSystem";

/**
 * Ghost lifecycle: prefly → homing → fallback → destroyed.
 * Cooldown starts after ghost is destroyed (full cycle).
 * In-own-home grace: 0.5 s then ghost is destroyed.
 */
export class GhostSystem {
  private active: Ghost | null = null;
  private cooldownEnd = 0;
  private cooldownSec: number = BALANCE.splitCooldownSec;

  /** Running id counter for ghost entity ids. Start above hero id (1). */
  private nextId = 100;

  constructor(
    private scene: Phaser.Scene,
    private hero: Hero,
    private trails: TrailSystem,
  ) {
    this.scene.events.on(GameEvents.SplitRequest, this.tryFire, this);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  canSplit(nowMs: number): boolean {
    return this.active === null && nowMs >= this.cooldownEnd;
  }

  /** 0 → just used, 1 → fully recharged. */
  getCooldownRatio(nowMs: number): number {
    if (this.cooldownSec <= 0) return 1;
    const remaining = Math.max(0, this.cooldownEnd - nowMs) / 1000;
    return 1 - Math.min(1, remaining / this.cooldownSec);
  }

  isActive(): boolean {
    return this.active !== null;
  }

  setCooldownSec(sec: number): void {
    this.cooldownSec = Math.max(GHOST.cooldownMinSec, sec);
  }

  spawnGhost(hero: Hero): Ghost | null {
    if (this.active !== null) return null;

    const preflySec = GHOST.preflySec + hero.homingDelayBonusSec;
    const ghost = new Ghost(this.nextId++, hero.id);
    ghost.spawn(hero.pos, hero.heading, hero.speedCellsPerSec, preflySec);

    this.active = ghost;
    this.trails.ensure(ghost.id);

    this.scene.events.emit(GameEvents.GhostSpawned, {
      pos: { x: ghost.pos.x, y: ghost.pos.y },
      heading: ghost.heading,
    });

    // Subscribe: enemy cuts ghost trail → only ghost dies, hero survives.
    this.scene.events.on(GameEvents.TrailCut, this.onTrailCut, this);

    return ghost;
  }

  update(dt: number, nowMs: number, hero: Hero): void {
    const ghost = this.active;

    // Emit cooldown progress even when no ghost is active.
    if (ghost === null) {
      const remaining = Math.max(0, this.cooldownEnd - nowMs) / 1000;
      const total = this.cooldownSec;
      this.scene.events.emit(GameEvents.SplitCooldown, { remaining, total });
      return;
    }

    // Homing steering before tick so position is integrated with new heading.
    if (ghost.phase === "homing" || ghost.phase === "fallback") {
      ghost.steerToward(hero.pos, GHOST.homingTurnRateRadPerSec, dt);
    }

    const newPhase = ghost.tick(dt);

    // Circular boundary clamp.
    const ddx = ghost.pos.x - MAP.centerX;
    const ddy = ghost.pos.y - MAP.centerY;
    if (ddx * ddx + ddy * ddy > MAP.radiusPx * MAP.radiusPx) {
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      const k = MAP.radiusPx / d;
      ghost.pos.x = MAP.centerX + ddx * k;
      ghost.pos.y = MAP.centerY + ddy * k;
    }

    if (newPhase !== null) {
      this.scene.events.emit(GameEvents.GhostPhaseChanged, {
        phase: newPhase,
        ghostId: ghost.id,
      });
    }

    // Spawn guard: don't record/test trail until ghost has moved past spawn radius.
    // Without this, ghost spawning on hero's existing trail closes the loop instantly.
    const dx = ghost.pos.x - ghost.spawnPos.x;
    const dy = ghost.pos.y - ghost.spawnPos.y;
    const guardPx = GHOST.spawnGuardCells * GRID.cellPx;
    if (dx * dx + dy * dy > guardPx * guardPx) {
      this.trails.appendAndTest(ghost.id, ghost.pos);
    }

    // Record world position for smooth trail rendering.
    this.appendGhostPosHistory(ghost);

    // In-home timer guard (prevents trivial loops inside own territory).
    // TrailSystem will call back if ghost is inside home — we track via inHomeTimer.
    // Increment handled externally via markInHome(); here we just check the limit.
    if (ghost.inHomeTimer >= GHOST.inOwnHomeMaxSec) {
      this.destroyGhost("fallback", nowMs);
      return;
    }

    if (!ghost.alive) {
      this.destroyGhost("killed", nowMs);
    }
  }

  /** Called by TerritorySystem / GridSystem when ghost is inside its own home. */
  markInHome(dt: number): void {
    if (this.active === null) return;
    this.active.inHomeTimer += dt;
  }

  /** Called by TerritorySystem when ghost trail closes a loop. */
  onLoopClosed(): void {
    if (this.active === null) return;
    const nowMs = this.scene.time.now;
    this.destroyGhost("captured", nowMs);
  }

  destroyGhost(reason: "captured" | "killed" | "fallback", nowMs: number): void {
    const ghost = this.active;
    if (ghost === null) return;

    ghost.kill();
    ghost.posHistory = [];
    this.trails.clear(ghost.id);
    this.active = null;

    // Cooldown starts NOW (after full cycle).
    this.cooldownEnd = nowMs + this.cooldownSec * 1000;

    this.scene.events.off(GameEvents.TrailCut, this.onTrailCut, this);
    this.scene.events.emit(GameEvents.GhostDestroyed, { ghostId: ghost.id, reason });
    this.scene.events.emit(GameEvents.GhostExpired, { reason });
  }

  getActive(): Ghost | null {
    return this.active;
  }

  destroy(): void {
    this.scene.events.off(GameEvents.SplitRequest, this.tryFire, this);
    this.scene.events.off(GameEvents.TrailCut, this.onTrailCut, this);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private tryFire(): void {
    const nowMs = this.scene.time.now;
    if (!this.canSplit(nowMs) || !this.hero.alive) return;
    this.spawnGhost(this.hero);
  }

  private appendGhostPosHistory(ghost: Ghost): void {
    const hist = ghost.posHistory;
    const last = hist[hist.length - 1];
    if (last !== undefined) {
      const dx = ghost.pos.x - last.x;
      const dy = ghost.pos.y - last.y;
      const threshold = RENDER.trail.sampleDistPx;
      if (dx * dx + dy * dy < threshold * threshold) return;
    }
    hist.push({ x: ghost.pos.x, y: ghost.pos.y });
    if (hist.length > RENDER.trail.maxHistoryLen) {
      hist.shift();
    }
  }

  private onTrailCut(payload: { victim: number; killer: number }): void {
    const ghost = this.active;
    if (ghost === null) return;

    // Only react if the victim is the ghost (not the hero).
    if (payload.victim !== ghost.id) return;

    const nowMs = this.scene.time.now;
    this.destroyGhost("killed", nowMs);
    // Hero stays alive — no player:died emitted here.
  }
}
