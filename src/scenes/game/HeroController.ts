import Phaser from "phaser";
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

  // Spawn-intro state
  private _spawnGraceUntilMs = 0;
  private _spawnGraceStartMs = 0;
  private _spawnGraceDurMs = 0;
  private _introGfx?: Phaser.GameObjects.Graphics;
  private readonly _intro = { scale: 0 };
  private _introTween?: Phaser.Tweens.Tween;
  private _pendingClaimPolygon: ReturnType<typeof circlePolygon> | null = null;
  private _pendingClaimRadius = 0;
  private _pendingClaimCenter = { x: 0, y: 0 };
  private _introClaimed = false;
  /** Lateral offset of the fall start, signed. Randomised per spawn. */
  private _introFallStartDX = 0;
  private _introSfxFallPlayed = false;
  private _introSfxLandPlayed = false;

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
    this._introGfx?.destroy();
    this._introGfx = undefined;
    this._introTween?.stop();
    this._introTween = undefined;
  }

  /** True while the hero is in the post-spawn grace period (visible but immobile). */
  inSpawnGrace(): boolean {
    return this.scene.time.now < this._spawnGraceUntilMs;
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
    // Defer the actual claim — territory paints in over the intro animation.
    this._pendingClaimPolygon = circlePolygon(worldPos.x, worldPos.y, radiusPx, 32);
    this._pendingClaimRadius = radiusPx;
    this._pendingClaimCenter.x = worldPos.x;
    this._pendingClaimCenter.y = worldPos.y;
    this._introClaimed = false;
    this.deps.trails.setPeerGroup(hero.id, [hero.id]);

    // Reset the "has input" flag so the intro-skip-on-first-input logic in
    // move() only triggers for input issued after this respawn.
    this.deps.input.resetInputFlag();

    this.beginSpawnIntro();
  }

  private commitPendingClaim(): void {
    if (this._introClaimed) return;
    if (!this._pendingClaimPolygon) return;
    this.deps.territory.claim(this.deps.hero.id, this._pendingClaimPolygon);
    this._pendingClaimPolygon = null;
    this._introClaimed = true;
  }

  private beginSpawnIntro(): void {
    const dur = BALANCE.spawnGraceMs;
    const now = this.scene.time.now;
    this._spawnGraceStartMs = now;
    this._spawnGraceDurMs = dur;
    this._spawnGraceUntilMs = now + dur;

    this._introTween?.stop();
    this._intro.scale = 0;
    this._introSfxFallPlayed = false;
    this._introSfxLandPlayed = false;
    // Random side offset so each respawn feels fresh — falls from ±200..320px.
    const side = Math.random() < 0.5 ? -1 : 1;
    this._introFallStartDX = side * (200 + Math.random() * 120);

    if (!this._introGfx) {
      this._introGfx = this.scene.add.graphics().setDepth(32).setScrollFactor(1);
    }
  }

  /** Phase fractions of spawnGraceMs. Sum to 1.0. */
  private static readonly INTRO_FALL_FRAC = 0.42;
  private static readonly INTRO_LAND_FRAC = 0.08;
  private static readonly INTRO_PAINT_FRAC = 0.50;

  /** Wipe hero-owned grid + trail + visual + alive flag. Bots untouched. Returns new ghost. */
  release(isFirstRound: boolean): GhostSystem {
    const hero = this.deps.hero;
    // Drop any deferred spawn-paint so we don't claim after release.
    this._pendingClaimPolygon = null;
    this._introClaimed = true;
    this._spawnGraceUntilMs = 0;
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

    // Mobile only: first finger input cancels the spawn-intro freeze. The
    // 850ms intro is cosmetic — making the player wait through it on mobile
    // reads as "swipe is broken" because they swipe, see nothing for 600ms,
    // and assume the input was lost. Desktop keeps the full intro since the
    // cursor is always implicitly "inputting" and skipping would remove the
    // animation entirely.
    if (
      this.inSpawnGrace() &&
      this.deps.input.isTouchDevice() &&
      this.deps.input.playerHasInput()
    ) {
      this._spawnGraceUntilMs = 0;
      this.commitPendingClaim();
    }

    if (this.inSpawnGrace()) {
      hero.velocity.x = 0;
      hero.velocity.y = 0;
      this._drawIntro();
      return null;
    }
    this._clearIntro();

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

    this.deps.input.resetInputFlag();
    this.beginSpawnIntro();
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

  /** Returns the current hero render scale (0..1+) used by GameRenderer. */
  getRenderScale(): number {
    if (!this.inSpawnGrace()) return 1;
    const dur = this._spawnGraceDurMs;
    if (dur <= 0) return 1;
    const elapsed = this.scene.time.now - this._spawnGraceStartMs;
    const fallEnd = dur * HeroController.INTRO_FALL_FRAC;
    const landEnd = fallEnd + dur * HeroController.INTRO_LAND_FRAC;
    if (elapsed < fallEnd) return 0;
    if (elapsed < landEnd) {
      // Squash on impact: scale Y less, but our scale is uniform — fake by
      // briefly oversizing then settling back.
      const k = (elapsed - fallEnd) / Math.max(1, landEnd - fallEnd);
      return 1 + 0.25 * (1 - k);
    }
    return 1;
  }

  private _drawIntro(): void {
    if (!this._introGfx) {
      this._introGfx = this.scene.add.graphics().setDepth(32).setScrollFactor(1);
    }
    const hero = this.deps.hero;
    const color = this.deps.heroFill();
    const g = this._introGfx;
    g.setVisible(true);
    g.clear();

    const dur = this._spawnGraceDurMs;
    if (dur <= 0) return;
    const elapsed = this.scene.time.now - this._spawnGraceStartMs;

    const cx = hero.pos.x;
    const cy = hero.pos.y;

    const fallDur = dur * HeroController.INTRO_FALL_FRAC;
    const landDur = dur * HeroController.INTRO_LAND_FRAC;
    const paintDur = dur * HeroController.INTRO_PAINT_FRAC;
    const fallEnd = fallDur;
    const landEnd = fallEnd + landDur;

    const SHADOW = 0x000000;
    const RING_OUTLINE = 0x000000;
    const RING_INNER = 0xffffff;

    if (elapsed < fallEnd) {
      // ── FALL phase ──────────────────────────────────────────────────
      if (!this._introSfxFallPlayed) {
        this._introSfxFallPlayed = true;
        this._tryPlaySfx("sfx_split", 0.45, -200);
      }
      const tFall = Phaser.Math.Clamp(elapsed / fallDur, 0, 1);
      const eased = tFall * tFall; // accelerating fall
      const fallStartOffsetY = 360;
      const offY = -fallStartOffsetY * (1 - eased);
      const offX = this._introFallStartDX * (1 - eased);
      const heroDrawX = cx + offX;
      const heroDrawY = cy + offY;

      // Ground shadow grows / sharpens as the hero approaches.
      const shadowR = HERO_RADIUS_PX * (0.6 + 0.7 * eased);
      const shadowA = 0.15 + 0.45 * eased;
      g.fillStyle(SHADOW, shadowA);
      g.fillEllipse(cx, cy + 2, shadowR * 2.2, shadowR * 0.9);

      // Motion streak — line trailing back along the diagonal travel direction.
      const trailLen = 30 * (1 - eased * 0.3);
      const dirLen = Math.hypot(this._introFallStartDX, fallStartOffsetY) || 1;
      const tx = -this._introFallStartDX / dirLen;
      const ty = fallStartOffsetY / dirLen;
      g.lineStyle(3, RING_INNER, 0.4 * (1 - eased));
      g.lineBetween(heroDrawX, heroDrawY, heroDrawX + tx * trailLen, heroDrawY + ty * trailLen);
      g.lineStyle(2, color, 0.55 * (1 - eased));
      g.lineBetween(
        heroDrawX,
        heroDrawY,
        heroDrawX + tx * trailLen * 0.7,
        heroDrawY + ty * trailLen * 0.7,
      );

      // The falling hero — drawn here because GameRenderer hides it (scale=0).
      const heroR = HERO_RADIUS_PX * (0.85 + 0.15 * eased);
      g.fillStyle(SHADOW, 0.45);
      g.fillCircle(heroDrawX, heroDrawY + 1, heroR + 2);
      g.fillStyle(color, 1);
      g.fillCircle(heroDrawX, heroDrawY, heroR);
      g.lineStyle(2, RING_OUTLINE, 0.8);
      g.strokeCircle(heroDrawX, heroDrawY, heroR);
    } else if (elapsed < landEnd) {
      // ── LAND impact ────────────────────────────────────────────────
      if (!this._introSfxLandPlayed) {
        this._introSfxLandPlayed = true;
        this._tryPlaySfx("sfx_capture", 0.7, 200);
      }
      const tLand = Phaser.Math.Clamp((elapsed - fallEnd) / landDur, 0, 1);
      // Dust burst rings.
      for (let i = 0; i < 2; i++) {
        const k = Phaser.Math.Clamp(tLand + i * 0.25, 0, 1);
        const r = HERO_RADIUS_PX * (1.2 + 4.5 * k);
        const a = (1 - k) * 0.85;
        if (a < 0.02) continue;
        g.lineStyle(4, RING_OUTLINE, a * 0.5);
        g.strokeCircle(cx, cy, r);
        g.lineStyle(2, RING_INNER, a);
        g.strokeCircle(cx, cy, r);
      }
      // Outline halo on the (now visible) hero so it pops on its own land.
      g.lineStyle(3, RING_OUTLINE, 0.55);
      g.strokeCircle(cx, cy, HERO_RADIUS_PX * 1.45);
    } else {
      // ── PAINT phase ────────────────────────────────────────────────
      const tPaint = Phaser.Math.Clamp((elapsed - landEnd) / paintDur, 0, 1);
      const eased = 1 - (1 - tPaint) * (1 - tPaint); // ease-out
      const targetR = this._pendingClaimRadius;
      const r = targetR * eased;

      const px = this._pendingClaimCenter.x;
      const py = this._pendingClaimCenter.y;

      if (r > 1 && !this._introClaimed) {
        // Shadow under the growing disc — mimics territory shadow pass.
        g.fillStyle(SHADOW, 0.35);
        g.fillCircle(px + 3, py + 3, r);
        // Filled disc preview in territory colour.
        g.fillStyle(color, 0.85);
        g.fillCircle(px, py, r);
        // Bright leading edge to sell the "paint" feel.
        g.lineStyle(3, RING_INNER, 0.9 * (1 - eased) + 0.2);
        g.strokeCircle(px, py, r);
      }

      // Outline halo on the hero so it stays distinguishable on its colour.
      g.lineStyle(3, RING_OUTLINE, 0.5);
      g.strokeCircle(cx, cy, HERO_RADIUS_PX * 1.4);

      // Commit the real claim once paint finishes.
      if (tPaint >= 1) this.commitPendingClaim();
    }
  }

  private _tryPlaySfx(key: string, volume: number, detune: number): void {
    try {
      const cache = this.scene.cache.audio;
      if (!cache.exists(key)) return;
      this.scene.sound.play(key, { volume, detune });
    } catch {
      /* sound unavailable — silent */
    }
  }

  private _clearIntro(): void {
    // Safety: ensure the deferred claim lands even if grace ended before paint.
    this.commitPendingClaim();
    if (this._introGfx?.visible) {
      this._introGfx.clear();
      this._introGfx.setVisible(false);
    }
  }

  /** Smallest signed angle difference in [-PI, PI]. */
  private _angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
}
