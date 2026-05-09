import type Phaser from "phaser";
import { GHOST } from "@config/ghost";
import { GRID } from "@config/grid";
import { BALANCE } from "@config/balance";
import { RENDER } from "@config/render";
import { GameEvents } from "@events/GameEvents";
import { Ghost } from "@entities/Ghost";
import type { Hero } from "@entities/Hero";
import type { TrailSystem } from "./TrailSystem";
import type { PolygonTerritorySystem } from "./PolygonTerritorySystem";
import type { GridSystem } from "./GridSystem";
import { Vec2Pool } from "@utils/Vec2Pool";
import { arenaSlide } from "@utils/arena";

/**
 * Ghost lifecycle: prefly → homing (straight flight) → destroyed on lifetime end.
 * Ghost no longer auto-returns home; player must position before firing so the
 * straight flight closes a loop with the hero's pre-launch trail.
 * Enemy bots stepping on the ghost trail kill the ghost.
 * Cooldown starts after ghost is destroyed (full cycle).
 */
export class GhostSystem {
  private active: Ghost | null = null;
  private cooldownEnd = 0;
  private cooldownSec: number = BALANCE.splitCooldownSec;

  /** Running id counter for ghost entity ids. Start above hero id (1). */
  private nextId = 100;

  private readonly _pool = new Vec2Pool();

  constructor(
    private scene: Phaser.Scene,
    private hero: Hero,
    private trails: TrailSystem,
    private territory: PolygonTerritorySystem,
    private grid?: GridSystem,
  ) {
    this.scene.events.on(GameEvents.SplitRequest, this.tryFire, this);
    this.scene.events.on(GameEvents.TrailCut, this.onTrailCut, this);
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

    const preflySec = GHOST.preflySec;
    const maxLifetimeSec = GHOST.maxLifetimeSec + hero.ghostLifetimeBonusSec;
    const ghost = new Ghost(this.nextId++, hero.id);
    // Speed is stored in pixel-units so Ghost.tick (which does not know about
    // grid scale) advances at the correct world-space rate. Hero's
    // speedCellsPerSec is in logical cells/sec; multiply by cellPx to get px/sec.
    const effectiveSpeedMult = GHOST.speedMult + hero.ghostSpeedBonusMult;
    const speedPxPerSec = hero.speedCellsPerSec * GRID.cellPx * effectiveSpeedMult;
    ghost.spawn(hero.pos, hero.heading, speedPxPerSec, preflySec, maxLifetimeSec);

    this.active = ghost;
    this.trails.ensure(ghost.id);
    // Ghost trail is hostile: enemies stepping on it kill the ghost.

    // Snapshot the hero's pre-launch polyline so the closure check includes
    // it as part of the loop (route + ghost arc → capture).
    const heroTrail = this.trails.get(hero.id);
    if (heroTrail !== undefined && heroTrail.polylineLength() > 0) {
      ghost.spawnPolyline = heroTrail.getPolyline().slice();
    }

    this.scene.events.emit(GameEvents.GhostSpawned, {
      pos: { x: ghost.pos.x, y: ghost.pos.y },
      heading: ghost.heading,
    });

    return ghost;
  }

  update(dt: number, nowMs: number, hero: Hero): void {
    const ghost = this.active;

    // Emit cooldown progress every frame so the HUD ring reflects the live
    // state. While a ghost is in flight we report a full cooldown remaining
    // (ring empty) — the timer will then deplete after the ghost dies.
    {
      const total = this.cooldownSec;
      const remaining = ghost === null
        ? Math.max(0, this.cooldownEnd - nowMs) / 1000
        : total;
      this.scene.events.emit(GameEvents.SplitCooldown, { remaining, total });
    }

    if (ghost === null) {
      return;
    }

    const prevX = ghost.pos.x;
    const prevY = ghost.pos.y;

    const newPhase = ghost.tick(dt);

    // Lifetime ended (ghost would have entered fallback): destroy outright.
    if (newPhase === "fallback") {
      this.destroyGhost("fallback", nowMs);
      return;
    }

    // Circular boundary slide: deflect along the rim instead of stalling.
    const slid = arenaSlide(prevX, prevY, ghost.pos.x - prevX, ghost.pos.y - prevY);
    ghost.pos.x = slid.x;
    ghost.pos.y = slid.y;
    if (slid.hit) ghost.heading = slid.heading;

    if (newPhase !== null) {
      this.scene.events.emit(GameEvents.GhostPhaseChanged, {
        phase: newPhase,
        ghostId: ghost.id,
      });
    }

    // Track whether ghost has ever been outside hero territory. Until it has,
    // skip trail recording + closure check entirely — otherwise a ghost
    // launched from inside own home would close immediately on the first
    // post-guard frame against its own territory cell, capture nothing
    // (interior empty), and still get destroyed.
    if (!this.territory.isOwnedBy(ghost.pos.x, ghost.pos.y, hero.id)) {
      ghost.hasLeftHome = true;
    } else if (ghost.hasLeftHome) {
      ghost.inHomeTimer += dt;
    }

    // Spawn guard: don't record/test trail until ghost has moved past spawn radius.
    // Without this, ghost spawning on hero's existing trail closes the loop instantly.
    const dx = ghost.pos.x - ghost.spawnPos.x;
    const dy = ghost.pos.y - ghost.spawnPos.y;
    const guardPx = GHOST.spawnGuardCells * GRID.cellPx;
    if (ghost.hasLeftHome && dx * dx + dy * dy > guardPx * guardPx) {
      const result = this.trails.appendAndTest(
        ghost.id,
        ghost.pos,
        hero.id,
        undefined,
        ghost.spawnPolyline,
        { x: prevX, y: prevY },
      );
      if (result === "closed") {
        // Pre-launch hero trail was merged into the loop and captured. The
        // hero may have kept walking past the spawn point during ghost
        // flight; preserve the tail that's still outside own territory so
        // the next return-home closure captures the full path the player
        // actually walked.
        this.salvageHeroTrail(hero);
        this.destroyGhost("captured", nowMs);
        return;
      }
    }

    // Record world position for smooth trail rendering.
    this.appendGhostPosHistory(ghost);

    // In-home timer guard: once the ghost has left and re-entered own home,
    // it's destroyed after inOwnHomeMaxSec to prevent trivial loops.
    if (ghost.inHomeTimer >= GHOST.inOwnHomeMaxSec) {
      this.destroyGhost("fallback", nowMs);
      return;
    }

    if (!ghost.alive) {
      this.destroyGhost("killed", nowMs);
    }
  }

  destroyGhost(reason: "captured" | "killed" | "fallback", nowMs: number): void {
    const ghost = this.active;
    if (ghost === null) return;

    ghost.kill();
    this._pool.releaseAll(ghost.posHistory);
    ghost.posHistory.length = 0;
    this.trails.clear(ghost.id);
    this.active = null;

    // Cooldown starts NOW (after full cycle).
    this.cooldownEnd = nowMs + this.cooldownSec * 1000;

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

  /**
   * After a ghost-captured closure, rebuild the hero trail to keep only the
   * contiguous tail still outside own territory. Anything earlier was either
   * consumed by the loop or now lies inside the freshly-claimed area and
   * would otherwise corrupt the next closure / self-trail check.
   */
  private salvageHeroTrail(hero: Hero): void {
    const trail = this.trails.get(hero.id);
    const polyline = trail !== undefined ? trail.getPolyline().slice() : [];

    let firstOutside = polyline.length;
    for (let i = polyline.length - 1; i >= 0; i--) {
      const p = polyline[i];
      if (p === undefined) break;
      if (this.territory.isOwnedBy(p.x, p.y, hero.id)) break;
      firstOutside = i;
    }

    this.trails.clearTrail(hero.id);

    if (firstOutside < polyline.length) {
      const sampleDistSqPx = RENDER.trail.sampleDistPx * RENDER.trail.sampleDistPx;
      for (let i = firstOutside; i < polyline.length; i++) {
        const p = polyline[i];
        if (p === undefined) continue;
        this.trails.addPoint(hero.id, p.x, p.y, sampleDistSqPx);
      }
    }

    const hist = hero.posHistory;
    let firstOutsideHist = hist.length;
    for (let i = hist.length - 1; i >= 0; i--) {
      const p = hist[i];
      if (p === undefined) break;
      if (this.territory.isOwnedBy(p.x, p.y, hero.id)) break;
      firstOutsideHist = i;
    }
    if (firstOutsideHist > 0) {
      const removed = hist.splice(0, firstOutsideHist);
      this._pool.releaseAll(removed);
    }
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
    hist.push(this._pool.acquire(ghost.pos.x, ghost.pos.y));
    if (hist.length > RENDER.trail.maxHistoryLen) {
      const evicted = hist.shift();
      if (evicted !== undefined) this._pool.release(evicted);
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
