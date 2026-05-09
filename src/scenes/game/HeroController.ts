import type Phaser from "phaser";
import { ADS } from "@config/ads";
import { BALANCE } from "@config/balance";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { RENDER } from "@config/render";
import { GameEvents } from "@events/GameEvents";
import type { Hero } from "@entities/Hero";
import type { GridSystem } from "@systems/GridSystem";
import type { TrailSystem } from "@systems/TrailSystem";
import { ARENA_DISC_INRADIUS_FACTOR, type PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";
import type { GhostSystem } from "@systems/GhostSystem";
import type { BotAI } from "@systems/BotAI";
import type { InputSystem } from "@systems/InputSystem";
import { Vec2Pool } from "@utils/Vec2Pool";
import { circlePolygon } from "@utils/polygon";
import { TrailMover } from "@systems/TrailMover";

/** Minimum angle change (radians) to trigger a squash. ~22.5 degrees. */
const SQUASH_ANGLE_THRESHOLD = Math.PI / 8;
/** Hero circle radius in px — must match GameRenderer's HERO_RADIUS_PX. */
const HERO_RADIUS_PX = 10;

export type DeathCause = "trail_cut";

export interface HeroDeps {
  hero: Hero;
  grid: GridSystem;
  trails: TrailSystem;
  territory: PolygonTerritorySystem;
  ghostSys: () => GhostSystem;
  /** Rebuild GhostSystem after a release (returns the new instance). */
  rebuildGhost: () => GhostSystem;
  botAI: BotAI;
  input: InputSystem;
  /** Current hero fill color (for squash overlay). */
  heroFill: () => number;
}

export class HeroController {
  private readonly _pool = new Vec2Pool();
  /** Scratch Vec2 for prevPos — avoids per-frame allocation. */
  private readonly _prevPos = { x: 0, y: 0 };
  /** True when the previous move ended on the arena rim. Drives rim-stickiness. */
  private _wasOnRim = false;
  private readonly trailMover: TrailMover;

  // Squash-and-stretch state
  private _lastHeading = 0;
  private _squashGfx?: Phaser.GameObjects.Graphics;
  /** Mutable scale object driven by the squash tween. */
  private readonly _squash = { scaleX: 1, scaleY: 1 };
  private _squashTween?: Phaser.Tweens.Tween;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: HeroDeps,
  ) {
    this.trailMover = new TrailMover(this.deps.trails, this.deps.territory);
  }

  destroy(): void {
    this._squashGfx?.destroy();
    this._squashGfx = undefined;
    this._squashTween?.stop();
    this._squashTween = undefined;
  }

  spawn(): void {
    const hero = this.deps.hero;
    const grid = this.deps.grid;
    const safe = this.pickRandomSpawnCell();
    const r = GRID.startTerritoryRadiusCells;

    const worldPos = grid.cellToWorld(safe);
    hero.pos = { x: worldPos.x, y: worldPos.y };
    hero.heading = 0;
    hero.alive = true;
    this.clearPosHistory();
    hero.velocity = { x: 0, y: 0 };
    this._wasOnRim = false;

    const radiusPx = r * grid.cellPx;
    const polygon = circlePolygon(worldPos.x, worldPos.y, radiusPx, 32);
    this.deps.territory.claim(hero.id, polygon);
    this.deps.trails.setPeerGroup(hero.id, [hero.id]);
  }

  /** Wipe hero-owned grid + trail + visual + alive flag. Bots untouched. Returns new ghost. */
  release(isFirstRound: boolean): GhostSystem {
    const hero = this.deps.hero;
    this.deps.territory.release(hero.id);
    this.deps.trails.clearTrail(hero.id);
    hero.alive = false;
    this.clearPosHistory();
    hero.velocity = { x: 0, y: 0 };
    this._wasOnRim = false;
    this.deps.ghostSys().destroy();
    const fresh = this.deps.rebuildGhost();
    if (isFirstRound) {
      fresh.setCooldownSec(BALANCE.splitCooldownFirstRoundSec);
    }
    this.deps.trails.setPeerGroup(hero.id, [hero.id]);
    return fresh;
  }

  /** Per-frame movement + collision/trail logic. Returns death cause if hero died. */
  move(dt: number): DeathCause | null {
    const hero = this.deps.hero;
    if (!hero.alive) return null;

    const grid = this.deps.grid;
    const trails = this.deps.trails;

    const heading = this.deps.input.getDesiredHeading();
    const newHeading = Math.atan2(heading.y, heading.x);

    // Detect significant heading change and trigger squash.
    const headingDelta = Math.abs(this._angleDiff(newHeading, this._lastHeading));
    if (headingDelta > SQUASH_ANGLE_THRESHOLD && (heading.x !== 0 || heading.y !== 0)) {
      this._triggerSquash(heading.x, heading.y);
    }
    this._lastHeading = newHeading;
    hero.heading = newHeading;

    this._drawSquash();

    const cellPx = grid.cellPx;
    const effectiveSpeed = hero.speedCellsPerSec * (1 + hero.passiveSpeedBonusMult);
    const dx = heading.x * effectiveSpeed * cellPx * dt;
    const dy = heading.y * effectiveSpeed * cellPx * dt;

    this._prevPos.x = hero.pos.x;
    this._prevPos.y = hero.pos.y;
    const prevOnOwn = this.deps.territory.isOwnedBy(this._prevPos.x, this._prevPos.y, hero.id);

    let newX = hero.pos.x + dx;
    let newY = hero.pos.y + dy;

    // Clamp to circular arena boundary. Use the territory polygon's inradius
    // (chord midpoint distance) rather than the full arena radius — the
    // arenaDisc is an inscribed N-gon, so points on the actual circle land
    // outside the polygon between vertices and ownerAt() returns neutral,
    // which would falsely start a trail on owned land near the rim.
    {
      const ddx = newX - MAP.centerX;
      const ddy = newY - MAP.centerY;
      const r2 = ddx * ddx + ddy * ddy;
      const R = MAP.radiusPx * ARENA_DISC_INRADIUS_FACTOR;
      if (r2 > R * R) {
        const k = R / Math.sqrt(r2);
        newX = MAP.centerX + ddx * k;
        newY = MAP.centerY + ddy * k;
      }
    }

    hero.pos.x = newX;
    hero.pos.y = newY;

    if (dt > 0) {
      hero.velocity.x = (newX - this._prevPos.x) / dt;
      hero.velocity.y = (newY - this._prevPos.y) / dt;
    }

    const oldPos = { x: this._prevPos.x, y: this._prevPos.y };
    const newOnOwn = this.deps.territory.isOwnedBy(hero.pos.x, hero.pos.y, hero.id);

    const heroTrail = trails.get(hero.id);
    const wasActive = heroTrail?.active === true && (heroTrail?.polylineLength() ?? 0) > 0;

    const result = this.trailMover.step(hero.id, hero.id, oldPos, hero.pos, {
      sampleDistSqPx: RENDER.trail.sampleDistPx * RENDER.trail.sampleDistPx,
      cutForgivePx: RENDER.trail.colliderRadiusPx,
    });

    if (newOnOwn) {
      if (wasActive) {
        trails.clearTrail(hero.id);
        this.clearPosHistory();
      }
    } else {
      // Anchor visual polyline at the prior in-territory position.
      if (!wasActive && prevOnOwn) {
        hero.posHistory.push(this._pool.acquire(this._prevPos.x, this._prevPos.y));
      }
      this.appendPosHistory(newX, newY);

      if (result === "closed") {
        trails.clearTrail(hero.id);
        this.clearPosHistory();
      }
    }

    return null;
  }

  applyContinue(): void {
    const hero = this.deps.hero;
    const grid = this.deps.grid;
    const safeCell = this.findSafeRespawnCell();
    const worldPos = grid.cellToWorld(safeCell);

    hero.pos = { x: worldPos.x, y: worldPos.y };
    hero.alive = true;
    hero.heading = 0;
    this.clearPosHistory();
    hero.velocity = { x: 0, y: 0 };
    this._wasOnRim = false;

    this.deps.trails.clearTrail(hero.id);
    this.deps.territory.shrink(hero.id, ADS.continueRetainTerritoryPct);
  }

  emitDied(cause: DeathCause): void {
    // Idempotent — multiple bots stepping on the hero's trail in the same
    // frame each emit TrailCut(victim=hero) and re-enter this handler.
    // Guard prevents duplicate PlayerDied events (which produced stacked
    // death sounds + RGB-split + slowmo + shake).
    if (!this.deps.hero.alive) return;
    this.deps.hero.alive = false;
    this.scene.events.emit(GameEvents.PlayerDied, { cause });
  }

  /** Pick a random unowned cell inside the play area, away from claimed cells. */
  private pickRandomSpawnCell(): { cx: number; cy: number } {
    const grid = this.deps.grid;
    const hero = this.deps.hero;
    const territory = this.deps.territory;
    const r = GRID.startTerritoryRadiusCells;
    const cols = grid.cols;
    const rows = grid.rows;
    const cellPx = grid.cellPx;
    const innerR = MAP.radiusPx - (r + 2) * cellPx;
    const probePx = r * cellPx;

    // 5-point sample at the start-territory ring instead of (2r+1)² scan —
    // the dense scan was costing tens of thousands of point-in-polygon tests
    // per spawn against the bot territory list.
    const isClear = (wx: number, wy: number): boolean => {
      const c = territory.ownerAt(wx, wy);
      if (c !== 0 && c !== hero.id) return false;
      const e = territory.ownerAt(wx + probePx, wy);
      if (e !== 0 && e !== hero.id) return false;
      const w = territory.ownerAt(wx - probePx, wy);
      if (w !== 0 && w !== hero.id) return false;
      const s = territory.ownerAt(wx, wy + probePx);
      if (s !== 0 && s !== hero.id) return false;
      const n = territory.ownerAt(wx, wy - probePx);
      if (n !== 0 && n !== hero.id) return false;
      return true;
    };

    for (let attempt = 0; attempt < 48; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * Math.max(0, innerR);
      const wx = MAP.centerX + Math.cos(ang) * rad;
      const wy = MAP.centerY + Math.sin(ang) * rad;
      if (!isClear(wx, wy)) continue;
      const { cx, cy } = grid.worldToCell({ x: wx, y: wy });
      return { cx, cy };
    }
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const fwx = cx * cellPx + cellPx * 0.5;
        const fwy = cy * cellPx + cellPx * 0.5;
        if (territory.ownerAt(fwx, fwy) === 0) return { cx, cy };
      }
    }
    return { cx: Math.floor(cols / 2), cy: Math.floor(rows / 2) };
  }

  private findSafeRespawnCell(): { cx: number; cy: number } {
    const grid = this.deps.grid;
    const hero = this.deps.hero;
    const cols = grid.cols;
    const rows = grid.rows;
    const bots = this.deps.botAI.getAll().filter((b) => b.alive);

    let bestCx = Math.floor(cols / 2);
    let bestCy = Math.floor(rows / 2);
    let bestDist = -1;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const wx = cx * grid.cellPx + grid.cellPx * 0.5;
        const wy = cy * grid.cellPx + grid.cellPx * 0.5;
        if (!this.deps.territory.isOwnedBy(wx, wy, hero.id)) continue;

        let minBotDist = Infinity;
        for (const bot of bots) {
          const d = Math.hypot(bot.pos.x - wx, bot.pos.y - wy);
          if (d < minBotDist) minBotDist = d;
        }

        if (minBotDist > bestDist) {
          bestDist = minBotDist;
          bestCx = cx;
          bestCy = cy;
        }
      }
    }

    return { cx: bestCx, cy: bestCy };
  }

  private clearPosHistory(): void {
    const hist = this.deps.hero.posHistory;
    this._pool.releaseAll(hist);
    hist.length = 0;
  }

  private appendPosHistory(x: number, y: number): void {
    const hist = this.deps.hero.posHistory;
    const last = hist[hist.length - 1];
    if (last !== undefined) {
      const dx = x - last.x;
      const dy = y - last.y;
      const threshold = RENDER.trail.sampleDistPx;
      if (dx * dx + dy * dy < threshold * threshold) return;
    }
    hist.push(this._pool.acquire(x, y));
    if (hist.length > RENDER.trail.maxHistoryLen) {
      const evicted = hist.shift();
      if (evicted !== undefined) this._pool.release(evicted);
    }
  }

  // ── Squash helpers ────────────────────────────────────────

  private _triggerSquash(dx: number, dy: number): void {
    const cfg = RENDER.heroSquash;

    // Kill previous tween before starting a new one.
    if (this._squashTween?.isPlaying()) {
      this._squashTween.stop();
    }

    // Determine squash axis: compress along movement direction.
    const isHorizontal = Math.abs(dx) >= Math.abs(dy);
    const squashX = isHorizontal ? 1 - cfg.amount : 1 + cfg.amount * 0.5;
    const squashY = isHorizontal ? 1 + cfg.amount * 0.5 : 1 - cfg.amount;

    this._squash.scaleX = squashX;
    this._squash.scaleY = squashY;

    this._squashTween = this.scene.tweens.add({
      targets: this._squash,
      scaleX: 1,
      scaleY: 1,
      duration: cfg.durationMs,
      ease: "Quad.easeOut",
    });
  }

  private _drawSquash(): void {
    const sx = this._squash.scaleX;
    const sy = this._squash.scaleY;
    const isIdentity = Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005;

    if (isIdentity) {
      if (this._squashGfx) {
        this._squashGfx.setVisible(false);
      }
      return;
    }

    // Lazy-create graphics at depth just above the unit layer (30 + 1).
    if (!this._squashGfx) {
      this._squashGfx = this.scene.add.graphics().setDepth(31);
    }

    const hero = this.deps.hero;
    const color = this.deps.heroFill();

    this._squashGfx.setVisible(true);
    this._squashGfx.clear();
    this._squashGfx.fillStyle(color, 1);
    this._squashGfx.fillEllipse(
      hero.pos.x,
      hero.pos.y,
      HERO_RADIUS_PX * 2 * sx,
      HERO_RADIUS_PX * 2 * sy,
    );
  }

  /** Smallest signed angle difference in [-PI, PI]. */
  private _angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
}
