import Phaser from "phaser";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { PALETTE } from "@config/palette";
import { RENDER } from "@config/render";
import type { GridSystem } from "@systems/GridSystem";
import type { TrailSystem } from "@systems/TrailSystem";
import type { BotAI } from "@systems/BotAI";
import type { GhostSystem } from "@systems/GhostSystem";
import type { PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";
import type { Bot } from "@entities/Bot";
import type { Hero } from "@entities/Hero";
import type { Vec2 } from "@gametypes/geometry";
import { GameEvents } from "@events/GameEvents";
import type { TerritoryCapturedPayload } from "@gametypes/events";
import { shadeColor } from "@utils/color";
import { PatternTextureCache } from "./PatternTextureCache";
import type { PatternId } from "@config/skinPatterns";
import { SKINS } from "@config/skins";

const DEPTH_BG = 0;
const DEPTH_TERRITORY = 10;
const DEPTH_TRAIL = 20;
const DEPTH_UNIT = 30;

const HERO_RADIUS_PX = 10;
const BOT_RADIUS_PX = 9;

const SPLIT_TRI_HALF = 6;
const SPLIT_TRI_GAP_MIN = 2;
const SPLIT_TRI_GAP_MAX = 11;

const GLOW_BOT_COUNT = 5;

// Movement-dust particles tinted with the territory color a unit is on.
const MAX_DUST = 120;                  // hard cap — evict oldest on overflow
const DUST_SPAWN_INTERVAL_MS = 65;     // min gap between spawns per unit
const DUST_SPAWN_CHANCE = 0.7;         // probabilistic spawn → less rhythmic
const DUST_LIFE_MS = 420;              // particle lifetime (mean)
const DUST_LIFE_JITTER = 0.55;         // ±55%
const DUST_BASE_RADIUS = 3.6;          // px
const DUST_RADIUS_JITTER = 0.55;       // ±55%
const DUST_SHADE_BASE = -0.22;
const DUST_SHADE_JITTER = 0.18;        // ± shade
const DUST_BACK_OFFSET_RANGE: [number, number] = [2, 7];
const DUST_LATERAL_RANGE = 7;          // ± perpendicular px
const DUST_DRIFT_PX_PER_SEC = 22;      // base drift speed magnitude
const DUST_DRIFT_JITTER = 0.7;         // ±70% of drift speed
const DUST_MOVE_THRESHOLD_SQ = 0.5;    // squared px — only spawn while moving

// Territory dissolve on death.
const DISSOLVE_DURATION_MS = RENDER.dissolveDurationMs;
const DISSOLVE_PARTICLES_PER_FRAME = 4;

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  age: number;
  life: number;
  radius: number;
}

export interface RendererDeps {
  grid: GridSystem;
  trails: TrailSystem;
  botAI: BotAI;
  territory: PolygonTerritorySystem;
  ghostSys: () => GhostSystem;
  hero: Hero;
  heroFill: () => number;
  heroTerritory: () => number;
  heroTrail: () => number;
  heroPattern: () => PatternId;
  heroFillSecondary: () => number | undefined;
}

const PATTERN_OVERLAY_ALPHA = 0.55;
const PATTERN_TILE_PX = 32;

export class GameRenderer {
  private bgGfx!: Phaser.GameObjects.Graphics;
  private territoryGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private unitGfx!: Phaser.GameObjects.Graphics;

  private splitTriSprite?: Phaser.GameObjects.Image;
  private ghostSprite?: Phaser.GameObjects.Image;
  private splitTriOutline?: Phaser.GameObjects.Image;
  private ghostOutline?: Phaser.GameObjects.Image;
  /** Per-bot-ghost smooth triangle sprites (fill + outline), pooled by ghost id. */
  private botGhostSprites = new Map<number, { fill: Phaser.GameObjects.Image; outline: Phaser.GameObjects.Image }>();

  private heroHighlightGfx?: Phaser.GameObjects.Graphics;
  private heroOwnMaskGfx?: Phaser.GameObjects.Graphics;

  private patternCache!: PatternTextureCache;
  /** Per-owner TileSprite covering the world, masked by their territory. */
  private patternSprites = new Map<number, Phaser.GameObjects.TileSprite>();
  /** Last texture key applied to each owner's sprite — avoids redundant setTexture calls. */
  private patternSpriteTexKey = new Map<number, string>();
  /** Per-owner geometry-mask graphics (kept in scene but not added to display list). */
  private patternMasks = new Map<number, Phaser.GameObjects.Graphics>();

  private dustGfx?: Phaser.GameObjects.Graphics;
  private dust: Dust[] = [];
  private dustLastSpawnMs = new Map<number, number>();
  private dustLastPos = new Map<number, { x: number; y: number }>();
  private lastFrameMs = 0;
  /** Owners whose territory is dissolving. Map<ownerId, dissolveStartMs>. */
  private dissolving = new Map<number, number>();
  /**
   * Snapshot of outer-ring vertices captured at the moment dissolve starts,
   * used to pick random burst positions without re-querying the territory system.
   * Map<ownerId, flat list of world-space points sampled from the outer ring>.
   */
  private dissolveSnapshot = new Map<number, Array<[number, number]>>();

  private territoryDirty = true;

  /**
   * Fade-out state for the ghost when it dies — captured from the last frame
   * the ghost was active so we can keep drawing its trail (and sprite) with
   * decaying alpha after the ghost entity itself is gone.
   */
  private ghostFade: {
    points: Vec2[];
    pos: Vec2;
    heading: number;
    startMs: number;
  } | null = null;
  /** Snapshot updated each frame while the ghost is alive. */
  private ghostLastSnapshot: { points: Vec2[]; pos: Vec2; heading: number } | null = null;

  /**
   * Per-bot-ghost fade state. Mirrors `ghostFade` for the hero ghost so each
   * enemy ghost gets a death animation: trail dashes fade, sprite scales up
   * and alpha-decays for `ghostFadeOutMs` after the ghost is gone.
   */
  private botGhostFades = new Map<number, {
    points: Vec2[];
    pos: Vec2;
    heading: number;
    color: number;
    startMs: number;
  }>();
  /** Snapshot updated each frame while a bot ghost is alive (id → snapshot). */
  private botGhostSnapshots = new Map<number, { points: Vec2[]; pos: Vec2; heading: number; color: number }>();

  // --- Trail incremental skip tracking ---
  /** Maps unitId → { len, lastX, lastY } from the last rendered frame. */
  private trailStateCache = new Map<number, { len: number; lastX: number; lastY: number }>();
  private trailsDirty = true;

  // --- Per-frame reusable collections (avoid allocating new Map/Set each frame) ---
  /** Reused in renderTerritory() — maps ownerId → fill color. */
  private ownerColorCache = new Map<number, number>();
  /** Reused in renderPatternOverlays() — set of ownerIds seen this frame. */
  private patternSeenCache = new Set<number>();
  /** Reused in renderUnits() — bot distance records (filled, then sorted in-place). */
  private botDistCache: Array<{ bot: Bot; dist: number }> = [];
  /** Per-frame map of botId → Bot built once at render() start, used everywhere. */
  private botByIdCache = new Map<number, Bot>();

  // --- Wave fill (task 1) ---
  /** Active wave-fill entries: owner → { seedX, seedY, startMs, radius }. */
  private waveFills = new Map<number, { seedX: number; seedY: number; startMs: number }>();
  /** Single shared Graphics for wave-fill overlay, rendered above territory. */
  private waveFillGfx?: Phaser.GameObjects.Graphics;

  // --- Bot trail crumble (task 9 phase 1) ---
  /** Per-bot trail snapshot kept for crumble animation after bot death. */
  private botTrailFades = new Map<number, {
    points: Vec2[];
    color: number;
    startMs: number;
  }>();

  // --- Explosion particles (task 9 phase 2) ---
  private explosionParticles: Array<{
    x: number; y: number; vx: number; vy: number;
    color: number; age: number; life: number; radius: number;
  }> = [];
  /** Flash entries: { x, y, startMs } for white radial flash on kill. */
  private deathFlashes: Array<{ x: number; y: number; startMs: number }> = [];
  private explosionGfx?: Phaser.GameObjects.Graphics;
  private explosionLastMs = 0;

  // --- Crown (task 11) ---
  private crownImg?: Phaser.GameObjects.Image;
  private crownOwnerId = 0;
  private crownOwnerPos: Vec2 = { x: 0, y: 0 };
  private crownLastUpdateMs = 0;

  // --- Trail pulse (task 14) ---
  private trailPulseGfx?: Phaser.GameObjects.Graphics;

  private readonly onTerritoryUpdate = (_payload: { owner: number; percent: number }): void => {
    this.territoryDirty = true;
  };

  private readonly onTerritoryCapturedWave = (payload: TerritoryCapturedPayload): void => {
    // Only animate wave-fill when the hero is the new owner. Bot-vs-bot transfers
    // would otherwise spawn flashy radial fills across the map.
    if (payload.ownerId !== this.deps.hero.id) return;
    if (payload.seedX !== undefined && payload.seedY !== undefined) {
      this.waveFills.set(payload.ownerId, {
        seedX: payload.seedX,
        seedY: payload.seedY,
        startMs: this.scene.time.now,
      });
      this.territoryDirty = true;
    }
  };

  private readonly onBotExplosion = (payload: {
    x: number | undefined;
    y: number | undefined;
    color: number;
    victim?: number;
    killer?: number;
  }): void => {
    if (payload.x === undefined || payload.y === undefined) return;
    // Only show explosion+flash when the hero is involved (as killer or victim).
    // Bot-vs-bot deaths still get the silent trail-crumble + territory melt.
    const heroId = this.deps.hero.id;
    const heroInvolved = payload.victim === heroId || payload.killer === heroId;
    if (!heroInvolved) return;
    const cfg = RENDER.botDeath;
    for (let i = 0; i < cfg.explosionParticles; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = cfg.explosionSpeedMin + Math.random() * (cfg.explosionSpeedMax - cfg.explosionSpeedMin);
      this.explosionParticles.push({
        x: payload.x,
        y: payload.y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        color: payload.color,
        age: 0,
        life: 380 + Math.random() * 120,
        radius: 3 + Math.random() * 4,
      });
    }
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: RendererDeps,
  ) {}

  markTerritoryDirty(): void {
    this.territoryDirty = true;
  }

  /** Begin a fade-out + particle burst across all cells of `ownerId`. */
  startDissolve(ownerId: number): void {
    this.dissolving.set(ownerId, this.scene.time.now);
    this.territoryDirty = true;
  }

  /** Stop a dissolve early (e.g., player chose Continue and territory restores). */
  cancelDissolve(ownerId: number): void {
    if (this.dissolving.delete(ownerId)) {
      this.dissolveSnapshot.delete(ownerId);
      this.territoryDirty = true;
    }
  }

  init(): void {
    this.patternCache = new PatternTextureCache(this.scene);
    // Bake pattern textures for every skin up-front so the first capture
    // doesn't trigger a Canvas2D stamp mid-frame. Solid skins are skipped.
    this.patternCache.warmup(SKINS);
    this.bgGfx = this.scene.add.graphics().setDepth(DEPTH_BG);
    this.territoryGfx = this.scene.add.graphics().setDepth(DEPTH_TERRITORY);
    // Dust sits between trails and units so it reads as ground spray.
    this.dustGfx = this.scene.add.graphics().setDepth(DEPTH_TRAIL + 0.5);
    this.trailGfx = this.scene.add.graphics().setDepth(DEPTH_TRAIL);
    this.unitGfx = this.scene.add.graphics().setDepth(DEPTH_UNIT);

    this.heroOwnMaskGfx = this.scene.make.graphics({}, false);
    this.heroHighlightGfx = this.scene.add.graphics().setDepth(DEPTH_UNIT + 0.5);
    this.heroHighlightGfx.setMask(this.heroOwnMaskGfx.createGeometryMask());

    if (this.scene.textures.exists("triangle")) {
      const triPx = SPLIT_TRI_HALF * 2.4;
      const outlineScale = 1.35;
      const heroFill = this.deps.heroFill();
      const outlineTint = shadeColor(heroFill, -0.45);

      this.splitTriOutline = this.scene.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 0.6)
        .setDisplaySize(triPx * outlineScale, triPx * outlineScale)
        .setTint(outlineTint)
        .setVisible(false)
        .setMask(this.heroOwnMaskGfx.createGeometryMask());

      this.splitTriSprite = this.scene.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 1)
        .setDisplaySize(triPx, triPx)
        .setTint(heroFill)
        .setVisible(false);

      this.ghostOutline = this.scene.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 0.6)
        .setDisplaySize(triPx * 1.05 * outlineScale, triPx * 1.05 * outlineScale)
        .setTint(outlineTint)
        .setVisible(false)
        .setMask(this.heroOwnMaskGfx.createGeometryMask());

      this.ghostSprite = this.scene.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 1)
        .setDisplaySize(triPx * 1.05, triPx * 1.05)
        .setTint(heroFill)
        .setVisible(false);
    }

    this.drawStaticBg();

    // Wave-fill overlay — shared single Graphics, drawn above territory fill.
    this.waveFillGfx = this.scene.add.graphics().setDepth(DEPTH_TERRITORY + 1);
    // Explosion / flash particles — above units.
    this.explosionGfx = this.scene.add.graphics().setDepth(DEPTH_UNIT + 2);
    // Crown — above everything. Phosphor SVG icon.
    this.crownImg = this.scene.add.image(0, 0, "ic_crown")
      .setDepth(DEPTH_UNIT + 3)
      .setDisplaySize(22, 22)
      .setTint(0xffd700)
      .setVisible(false);
    // Trail pulse — between trail and unit layers.
    this.trailPulseGfx = this.scene.add.graphics().setDepth(DEPTH_TRAIL + 0.3);

    this.scene.events.on(GameEvents.TerritoryUpdate, this.onTerritoryUpdate, this);
    this.scene.events.on(GameEvents.TerritoryCaptured, this.onTerritoryUpdate, this);
    this.scene.events.on(GameEvents.TerritoryCaptured, this.onTerritoryCapturedWave, this);
    this.scene.events.on("bot:explosion", this.onBotExplosion, this);

    // Wire up bot trail-crumble: when BotAI emits TrailCut, snapshot the trail
    // for phase-1 crumble animation before the data is cleared at 150 ms.
    this.scene.events.on(
      GameEvents.TrailCut,
      (payload: { victim: number; killer: number }) => {
        const bot = this.botByIdCache.get(payload.victim);
        if (!bot) return;
        // Skip the crumble snapshot if the dying bot's trail is fully off-screen
        // — it would animate invisibly but still cost gfx draw calls each frame.
        const heroId = this.deps.hero.id;
        const heroInvolved = payload.victim === heroId || payload.killer === heroId;
        if (!heroInvolved) {
          const cam = this.scene.cameras.main;
          const margin = 80;
          const minX = cam.scrollX - margin;
          const maxX = cam.scrollX + cam.width / cam.zoom + margin;
          const minY = cam.scrollY - margin;
          const maxY = cam.scrollY + cam.height / cam.zoom + margin;
          if (bot.pos.x < minX || bot.pos.x > maxX || bot.pos.y < minY || bot.pos.y > maxY) {
            return;
          }
        }
        const trail = this.deps.trails.get(bot.id);
        if (!trail) return;
        const pts = trail.getPolyline();
        if (pts.length < 2) return;
        this.botTrailFades.set(bot.id, {
          points: pts.map((p) => ({ x: p.x, y: p.y })),
          color: bot.color,
          startMs: this.scene.time.now,
        });
      },
      this,
    );

    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.events.off(GameEvents.TerritoryUpdate, this.onTerritoryUpdate, this);
      this.scene.events.off(GameEvents.TerritoryCaptured, this.onTerritoryUpdate, this);
      this.scene.events.off(GameEvents.TerritoryCaptured, this.onTerritoryCapturedWave, this);
      this.scene.events.off("bot:explosion", this.onBotExplosion, this);
      this.scene.events.off(GameEvents.TrailCut, undefined, this);
    });
  }

  render(): void {
    // Rebuild id→Bot index once per frame so all sub-methods do O(1) lookups.
    this.botByIdCache.clear();
    for (const bot of this.deps.botAI.getAll()) {
      this.botByIdCache.set(bot.id, bot);
    }

    const now = this.scene.time.now;

    if (this.territoryDirty) {
      this.renderTerritory();
      this.territoryDirty = false;
    }
    this.tickWaveFills(now);
    this.renderTrails();
    this.tickTrailPulse(now);
    this.tickDust();
    this.tickBotTrailFades(now);
    this.tickExplosions(now);
    this.renderUnits();
    this.tickCrown(now);
  }

  /** Spawn + age + render movement-dust particles. Tinted with territory color. */
  private tickDust(): void {
    const gfx = this.dustGfx;
    if (!gfx) return;
    const now = this.scene.time.now;
    const dt = this.lastFrameMs === 0 ? 16 : Math.min(64, now - this.lastFrameMs);
    this.lastFrameMs = now;

    const hero = this.deps.hero;

    const trySpawn = (
      id: number,
      x: number,
      y: number,
      heading: number,
    ): void => {
      const last = this.dustLastPos.get(id);
      this.dustLastPos.set(id, { x, y });
      if (!last) return;
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < DUST_MOVE_THRESHOLD_SQ) return;
      const lastSpawn = this.dustLastSpawnMs.get(id) ?? 0;
      if (now - lastSpawn < DUST_SPAWN_INTERVAL_MS) return;
      // Probabilistic gate breaks rhythmic look.
      if (Math.random() > DUST_SPAWN_CHANCE) return;
      this.dustLastSpawnMs.set(id, now);

      const baseColor = this.colorForPos(x, y);
      const shade = DUST_SHADE_BASE + (Math.random() * 2 - 1) * DUST_SHADE_JITTER;
      const color = shadeColor(baseColor, shade);

      // Spawn somewhere behind/around the unit.
      const back = DUST_BACK_OFFSET_RANGE[0]
        + Math.random() * (DUST_BACK_OFFSET_RANGE[1] - DUST_BACK_OFFSET_RANGE[0]);
      const lateral = (Math.random() * 2 - 1) * DUST_LATERAL_RANGE;
      const cosH = Math.cos(heading);
      const sinH = Math.sin(heading);
      const px = x - cosH * back - sinH * lateral;
      const py = y - sinH * back + cosH * lateral;

      // Drift in any direction — angle independent of heading for organic feel.
      const ang = Math.random() * Math.PI * 2;
      const speed = DUST_DRIFT_PX_PER_SEC * (1 + (Math.random() * 2 - 1) * DUST_DRIFT_JITTER);

      if (this.dust.length >= MAX_DUST) {
        // Evict oldest via swap-and-pop on index 0.
        this.dust[0] = this.dust[this.dust.length - 1] as Dust;
        this.dust.pop();
      }
      this.dust.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        color,
        age: 0,
        life: DUST_LIFE_MS * (1 + (Math.random() * 2 - 1) * DUST_LIFE_JITTER),
        radius: DUST_BASE_RADIUS * (1 + (Math.random() * 2 - 1) * DUST_RADIUS_JITTER),
      });
    };

    if (hero.alive) {
      trySpawn(hero.id, hero.pos.x, hero.pos.y, hero.heading);
    }
    // Cull off-screen bots: dust they'd spawn is invisible but still allocates
    // particles, eats the global MAX_DUST cap, and chews fillCircle calls.
    const cam = this.scene.cameras.main;
    const margin = 64;
    const visMinX = cam.scrollX - margin;
    const visMaxX = cam.scrollX + cam.width / cam.zoom + margin;
    const visMinY = cam.scrollY - margin;
    const visMaxY = cam.scrollY + cam.height / cam.zoom + margin;
    for (const bot of this.deps.botAI.getAll()) {
      if (!bot.alive) continue;
      if (bot.pos.x < visMinX || bot.pos.x > visMaxX) continue;
      if (bot.pos.y < visMinY || bot.pos.y > visMaxY) continue;
      trySpawn(bot.id, bot.pos.x, bot.pos.y, bot.heading);
    }

    // Dissolve bursts: spew random particles across each dissolving owner's cells.
    if (this.dissolving.size > 0) {
      this.spawnDissolveParticles(now);
      // Force territory redraw so the alpha fade is visible each frame.
      this.territoryDirty = true;
      // Clear out finished dissolves.
      for (const [ownerId, startMs] of this.dissolving) {
        if (now - startMs >= DISSOLVE_DURATION_MS) {
          this.dissolving.delete(ownerId);
          this.dissolveSnapshot.delete(ownerId);
        }
      }
    }

    // Update existing particles (swap-and-pop avoids O(n) splice shifts).
    const dtSec = dt / 1000;
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i] as Dust;
      d.age += dt;
      if (d.age >= d.life) {
        this.dust[i] = this.dust[this.dust.length - 1] as Dust;
        this.dust.pop();
        continue;
      }
      d.x += d.vx * dtSec;
      d.y += d.vy * dtSec;
    }

    // Render.
    gfx.clear();
    for (const d of this.dust) {
      const t = d.age / d.life;
      const alpha = (1 - t) * 0.75;
      const r = d.radius * (1 - t * 0.4);
      gfx.fillStyle(d.color, alpha);
      gfx.fillCircle(d.x, d.y, r);
    }
  }

  /** Burst N particles per frame sampled from dissolving owners' outer ring vertices. */
  private spawnDissolveParticles(now: number): void {
    const polyTerr = this.deps.territory;

    // Build snapshot from outer ring vertices once per ownerId.
    for (const ownerId of this.dissolving.keys()) {
      if (this.dissolveSnapshot.has(ownerId)) continue;
      const pts: Array<[number, number]> = [];
      const t = polyTerr.getTerritory(ownerId);
      if (t && !t.isEmpty()) {
        for (const polygon of t.multiPolygon) {
          const outer = polygon[0];
          if (outer) {
            for (const pair of outer) pts.push(pair);
          }
        }
      }
      this.dissolveSnapshot.set(ownerId, pts);
    }

    const cam = this.scene.cameras.main;
    const margin = 64;
    const visMinX = cam.scrollX - margin;
    const visMaxX = cam.scrollX + cam.width / cam.zoom + margin;
    const visMinY = cam.scrollY - margin;
    const visMaxY = cam.scrollY + cam.height / cam.zoom + margin;

    for (const [ownerId, pts] of this.dissolveSnapshot) {
      if (!this.dissolving.has(ownerId)) continue;
      if (pts.length === 0) continue;
      const startMs = this.dissolving.get(ownerId) ?? now;
      const progress = Math.min(1, (now - startMs) / DISSOLVE_DURATION_MS);
      const count = Math.max(1, Math.round(DISSOLVE_PARTICLES_PER_FRAME * (0.6 + progress)));
      for (let n = 0; n < count; n++) {
        // Pick random vertex and add sub-pixel jitter for spread effect.
        const idx = (Math.random() * pts.length) | 0;
        const vx = pts[idx] as [number, number];
        const x = vx[0] + (Math.random() * 2 - 1) * 12;
        const y = vx[1] + (Math.random() * 2 - 1) * 12;
        // Skip particles that would land off-camera — invisible but still chew
        // the MAX_DUST cap and per-frame fillCircle work.
        if (x < visMinX || x > visMaxX || y < visMinY || y > visMaxY) continue;
        const baseColor = this.colorForPos(x, y);
        const shade = DUST_SHADE_BASE + (Math.random() * 2 - 1) * DUST_SHADE_JITTER;
        const color = shadeColor(baseColor, shade);
        const ang = Math.random() * Math.PI * 2;
        const speed = 15 + Math.random() * 35;
        if (this.dust.length >= MAX_DUST) {
          this.dust[0] = this.dust[this.dust.length - 1] as Dust;
          this.dust.pop();
        }
        this.dust.push({
          x,
          y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed - 6,
          color,
          age: 0,
          life: DUST_LIFE_MS * (1 + (Math.random() * 2 - 1) * DUST_LIFE_JITTER),
          radius: DUST_BASE_RADIUS * (0.9 + Math.random() * 0.6),
        });
      }
    }
  }

  /** Color of the territory at world position (x, y). Owner color, or background for neutral. */
  private colorForPos(x: number, y: number): number {
    const owner = this.deps.territory.ownerAt(x, y);
    if (owner === 0) return PALETTE.bg;
    if (owner === this.deps.hero.id) return this.deps.heroTerritory();
    return this.botByIdCache.get(owner)?.color ?? PALETTE.gridLine;
  }

  private drawStaticBg(): void {
    const gfx = this.bgGfx;
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const cx = MAP.centerX;
    const cy = MAP.centerY;
    const r = MAP.radiusPx;

    const voidColor = shadeColor(PALETTE.bg, -0.18);
    gfx.fillStyle(voidColor, 1);
    gfx.fillRect(0, 0, worldW, worldH);

    const bw = MAP.borderWidthPx;
    gfx.fillStyle(shadeColor(PALETTE.bg, -0.32), 1);
    gfx.fillCircle(cx, cy, r + bw);

    gfx.fillStyle(shadeColor(PALETTE.bg, -0.12), 1);
    gfx.fillCircle(cx, cy, r + bw * 0.55);

    gfx.fillStyle(shadeColor(PALETTE.bg, 0.08), 1);
    gfx.fillCircle(cx, cy, r + 2);

    gfx.fillStyle(PALETTE.bg, 1);
    gfx.fillCircle(cx, cy, r);

    gfx.lineStyle(1, PALETTE.gridLine, GRID.bgLineAlpha);
    const step = GRID.cellPx * GRID.bgLineEvery;
    for (let x = 0; x <= worldW; x += step) {
      const dy = Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
      if (dy > 0) gfx.lineBetween(x, cy - dy, x, cy + dy);
    }
    for (let y = 0; y <= worldH; y += step) {
      const dx = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
      if (dx > 0) gfx.lineBetween(cx - dx, y, cx + dx, y);
    }

    gfx.lineStyle(2, shadeColor(PALETTE.bg, -0.45), 0.75);
    gfx.strokeCircle(cx, cy, r);
  }

  private renderTerritory(): void {
    const gfx = this.territoryGfx;
    gfx.clear();

    const cfg = RENDER.contour;
    const hero = this.deps.hero;
    const heroTerritory = this.deps.heroTerritory();
    const polyTerr = this.deps.territory;

    // Build ownerId → color map from active territories.
    const ownerColor = this.ownerColorCache;
    ownerColor.clear();
    for (const [ownerId, t] of polyTerr.getAllTerritories()) {
      if (t.isEmpty()) continue;
      const color = ownerId === hero.id
        ? heroTerritory
        : (this.botByIdCache.get(ownerId)?.color ?? PALETTE.gridLine);
      ownerColor.set(ownerId, color);
    }

    // Per-owner alpha (dissolve fade-out).
    const now = this.scene.time.now;
    const alphaFor = (ownerId: number): number => {
      const startMs = this.dissolving.get(ownerId);
      if (startMs === undefined) return 1;
      return Math.max(0, 1 - (now - startMs) / DISSOLVE_DURATION_MS);
    };

    // Helpers to trace a Pair ring into the graphics path.
    const traceRing = (
      g: Phaser.GameObjects.Graphics,
      ring: ReadonlyArray<[number, number]>,
      offX = 0,
      offY = 0,
    ): void => {
      if (ring.length < 2) return;
      const fp = ring[0] as [number, number];
      g.beginPath();
      g.moveTo(fp[0] + offX, fp[1] + offY);
      for (let i = 1; i < ring.length; i++) {
        const p = ring[i] as [number, number];
        g.lineTo(p[0] + offX, p[1] + offY);
      }
      g.closePath();
    };

    // Per-owner outer rings for this frame — used in fill/stroke/mask/pattern passes.
    const ownerRings = new Map<number, ReadonlyArray<[number, number]>[]>();
    for (const [ownerId] of ownerColor) {
      const t = polyTerr.getTerritory(ownerId);
      if (!t || t.isEmpty()) continue;
      const rings: ReadonlyArray<[number, number]>[] = [];
      for (const polygon of t.multiPolygon) {
        const outer = polygon[0];
        if (outer && outer.length >= 3) rings.push(outer);
      }
      if (rings.length > 0) ownerRings.set(ownerId, rings);
    }

    // Shadow pass.
    const shadowOff = cfg.shadowOffsetPx;
    for (const [ownerId, rings] of ownerRings) {
      const a = alphaFor(ownerId);
      if (a <= 0) continue;
      gfx.fillStyle(0x000000, cfg.shadowAlpha * a);
      for (const ring of rings) {
        if (ring.length < 3) continue;
        traceRing(gfx, ring, shadowOff, shadowOff);
        gfx.fillPath();
      }
    }

    // Fill pass.
    for (const [ownerId, rings] of ownerRings) {
      const a = alphaFor(ownerId);
      if (a <= 0) continue;
      const color = ownerColor.get(ownerId) ?? PALETTE.gridLine;
      gfx.fillStyle(color, RENDER.territory.fillAlpha * a);
      for (const ring of rings) {
        if (ring.length < 3) continue;
        traceRing(gfx, ring);
        gfx.fillPath();
      }
    }

    // Outer stroke pass.
    for (const [ownerId, rings] of ownerRings) {
      const a = alphaFor(ownerId);
      if (a <= 0) continue;
      const color = ownerColor.get(ownerId) ?? PALETTE.gridLine;
      const outColor = shadeColor(color, cfg.outerStrokeDarken);
      gfx.lineStyle(cfg.lineWidth, outColor, cfg.alpha * a);
      for (const ring of rings) {
        if (ring.length < 2) continue;
        traceRing(gfx, ring);
        gfx.strokePath();
      }
    }

    // Hero mask (used by heroHighlightGfx + splitTri outline).
    const maskGfx = this.heroOwnMaskGfx;
    if (maskGfx) {
      maskGfx.clear();
      const heroRings = ownerRings.get(hero.id);
      if (heroRings) {
        maskGfx.fillStyle(0xffffff, 1);
        for (const ring of heroRings) {
          if (ring.length < 3) continue;
          traceRing(maskGfx, ring);
          maskGfx.fillPath();
        }
      }
    }

    this.renderPatternOverlays(ownerRings, ownerColor, traceRing, alphaFor);
  }

  /**
   * Pattern overlay pass: for every owner with a non-solid pattern, ensure a
   * world-covering TileSprite tinted to the owner's color, masked by their
   * territory outer rings. Sprites are pooled by ownerId between frames.
   */
  private renderPatternOverlays(
    ownerRings: Map<number, ReadonlyArray<[number, number]>[]>,
    ownerColor: Map<number, number>,
    traceRing: (g: Phaser.GameObjects.Graphics, ring: ReadonlyArray<[number, number]>, offX?: number, offY?: number) => void,
    alphaFor: (ownerId: number) => number,
  ): void {
    const hero = this.deps.hero;
    const heroPattern = this.deps.heroPattern();
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;

    const seen = this.patternSeenCache;
    seen.clear();

    for (const [ownerId, rings] of ownerRings) {
      const a = alphaFor(ownerId);
      if (a <= 0) continue;

      let pattern: PatternId;
      let color: number;
      let secondary: number | undefined;
      if (ownerId === hero.id) {
        pattern = heroPattern;
        color = ownerColor.get(ownerId) ?? PALETTE.gridLine;
        secondary = this.deps.heroFillSecondary();
      } else {
        const bot = this.botByIdCache.get(ownerId);
        if (!bot) continue;
        pattern = bot.pattern;
        color = bot.color;
        secondary = bot.colorSecondary;
      }
      if (pattern === "solid") continue;
      seen.add(ownerId);

      const texKey = this.patternCache.ensure(pattern, color, secondary);

      // Mask graphics — rebuilt every time territory changes (territoryDirty was true).
      let mask = this.patternMasks.get(ownerId);
      if (!mask) {
        mask = this.scene.make.graphics({}, false);
        this.patternMasks.set(ownerId, mask);
      }
      // Always rebuild since we only enter renderTerritory when dirty.
      mask.clear();
      mask.fillStyle(0xffffff, 1);
      for (const ring of rings) {
        if (ring.length < 3) continue;
        traceRing(mask, ring);
        mask.fillPath();
      }

      // Sprite — created once per owner, reused thereafter.
      let sprite = this.patternSprites.get(ownerId);
      if (!sprite) {
        sprite = this.scene.add
          .tileSprite(0, 0, worldW, worldH, texKey)
          .setOrigin(0, 0)
          .setDepth(DEPTH_TERRITORY + 0.5);
        sprite.setMask(mask.createGeometryMask());
        this.patternSprites.set(ownerId, sprite);
        this.patternSpriteTexKey.set(ownerId, texKey);
      } else if (this.patternSpriteTexKey.get(ownerId) !== texKey) {
        sprite.setTexture(texKey);
        this.patternSpriteTexKey.set(ownerId, texKey);
      }
      sprite.setAlpha(PATTERN_OVERLAY_ALPHA * a);
      sprite.setVisible(true);
      void PATTERN_TILE_PX;
    }

    // Hide / clean up sprites for owners that no longer exist or went solid.
    for (const [ownerId, sprite] of this.patternSprites) {
      if (seen.has(ownerId)) continue;
      if (ownerRings.has(ownerId)) {
        sprite.setVisible(false);
        continue;
      }
      sprite.destroy();
      this.patternSprites.delete(ownerId);
      this.patternSpriteTexKey.delete(ownerId);
      const mask = this.patternMasks.get(ownerId);
      mask?.destroy();
      this.patternMasks.delete(ownerId);
    }
  }

  /** Mark trails dirty so next frame forces a full redraw. */
  markTrailsDirty(): void {
    this.trailsDirty = true;
  }

  private renderTrails(): void {
    const hero = this.deps.hero;
    const trails = this.deps.trails;
    const heroTrailColor = shadeColor(this.deps.heroTrail(), RENDER.trailLightenAmount);
    const ghost = this.deps.ghostSys().getActive();

    // Determine if any active trail has changed since last render.
    const trailChanged = (
      id: number,
      pts: Vec2[],
    ): boolean => {
      if (pts.length < 2) {
        const prev = this.trailStateCache.get(id);
        if (!prev) return false;
        this.trailStateCache.delete(id);
        return true;
      }
      const last = pts[pts.length - 1] as Vec2;
      const prev = this.trailStateCache.get(id);
      if (
        prev &&
        prev.len === pts.length &&
        prev.lastX === last.x &&
        prev.lastY === last.y
      ) {
        return false;
      }
      this.trailStateCache.set(id, { len: pts.length, lastX: last.x, lastY: last.y });
      return true;
    };

    let anyChanged = this.trailsDirty;
    this.trailsDirty = false;
    // Active ghost-trail fade keeps the canvas dirty until it expires.
    if (this.ghostFade) anyChanged = true;
    if (this.botGhostFades.size > 0) anyChanged = true;

    const heroTrail = trails.get(hero.id);
    const heroActive = heroTrail?.active === true && hero.posHistory.length > 1;
    if (trailChanged(hero.id, hero.alive && heroActive ? hero.posHistory : [])) anyChanged = true;

    const ghostActive = ghost !== null && ghost.alive && (trails.get(ghost.id)?.active === true) && ghost.posHistory.length > 1;
    if (ghost && trailChanged(ghost.id, ghostActive ? ghost.posHistory : [])) anyChanged = true;

    for (const bot of this.deps.botAI.getAll()) {
      const botActive = bot.alive && (trails.get(bot.id)?.active === true) && bot.posHistory.length > 1;
      if (trailChanged(bot.id, botActive ? bot.posHistory : [])) anyChanged = true;
    }

    // Track bot ghost trails so renderer redraws on changes.
    const activeGhosts = this.deps.botAI.getActiveGhosts();
    for (const { ghost: bg } of activeGhosts) {
      const bgActive = bg.alive && (trails.get(bg.id)?.active === true) && bg.posHistory.length > 1;
      if (trailChanged(bg.id, bgActive ? bg.posHistory : [])) anyChanged = true;
    }

    if (!anyChanged) return;

    const gfx = this.trailGfx;
    gfx.clear();

    if (hero.alive && heroActive) {
      this.drawSmoothTrail(
        gfx,
        hero.posHistory,
        RENDER.trail.heroLineWidth,
        heroTrailColor,
        RENDER.trail.heroAlpha,
      );
    }

    if (ghostActive && ghost) {
      const ghostTrail = trails.get(ghost.id);
      if (ghostTrail?.active) {
        this.drawDashedTrail(
          gfx,
          ghost.posHistory,
          RENDER.trail.ghostLineWidth,
          heroTrailColor,
          RENDER.trail.ghostAlpha,
          RENDER.trail.ghostDashPx,
          RENDER.trail.ghostGapPx,
        );
      }
      // Refresh fade snapshot every frame while the ghost is alive.
      this.ghostLastSnapshot = {
        points: ghost.posHistory.map((p) => ({ x: p.x, y: p.y })),
        pos: { x: ghost.pos.x, y: ghost.pos.y },
        heading: ghost.heading,
      };
    } else if (this.ghostLastSnapshot && !this.ghostFade) {
      // Ghost just disappeared — kick off the fade-out.
      this.ghostFade = {
        ...this.ghostLastSnapshot,
        startMs: this.scene.time.now,
      };
      this.ghostLastSnapshot = null;
    }

    if (this.ghostFade) {
      const elapsed = this.scene.time.now - this.ghostFade.startMs;
      const fadeT = elapsed / RENDER.trail.ghostFadeOutMs;
      if (fadeT >= 1 || this.ghostFade.points.length < 2) {
        this.ghostFade = null;
      } else {
        const k = 1 - fadeT;
        this.drawDashedTrail(
          gfx,
          this.ghostFade.points,
          RENDER.trail.ghostLineWidth * (0.6 + 0.4 * k),
          heroTrailColor,
          RENDER.trail.ghostAlpha * k,
          RENDER.trail.ghostDashPx,
          RENDER.trail.ghostGapPx,
        );
        // Force a redraw next frame so the fade keeps progressing even if
        // no other trail changed.
        this.trailsDirty = true;
      }
    }

    for (const bot of this.deps.botAI.getAll()) {
      if (!bot.alive) continue;
      const trail = trails.get(bot.id);
      if (!trail?.active) continue;
      if (bot.posHistory.length < 2) continue;
      this.drawSmoothTrail(
        gfx,
        bot.posHistory,
        RENDER.trail.botLineWidth,
        shadeColor(bot.color, RENDER.trailLightenAmount),
        RENDER.trail.botAlpha,
      );
    }

    // Bot ghost trails — dashed, tinted with owning bot color. Snapshot each
    // alive ghost so the fade-out can keep drawing the trail after death.
    const liveBotGhostIds = new Set<number>();
    for (const { ghost, color } of this.deps.botAI.getActiveGhosts()) {
      if (!ghost.alive) continue;
      liveBotGhostIds.add(ghost.id);
      const ghostTrail = trails.get(ghost.id);
      if (ghost.posHistory.length >= 2 && ghostTrail?.active) {
        this.drawDashedTrail(
          gfx,
          ghost.posHistory,
          RENDER.trail.ghostLineWidth,
          color,
          RENDER.trail.ghostAlpha,
          RENDER.trail.ghostDashPx,
          RENDER.trail.ghostGapPx,
        );
      }
      this.botGhostSnapshots.set(ghost.id, {
        points: ghost.posHistory.map((p) => ({ x: p.x, y: p.y })),
        pos: { x: ghost.pos.x, y: ghost.pos.y },
        heading: ghost.heading,
        color,
      });
    }

    // Any bot ghost we had a snapshot for that is no longer alive — kick fade.
    for (const [id, snap] of this.botGhostSnapshots) {
      if (liveBotGhostIds.has(id)) continue;
      if (!this.botGhostFades.has(id)) {
        this.botGhostFades.set(id, { ...snap, startMs: this.scene.time.now });
      }
      this.botGhostSnapshots.delete(id);
    }

    // Render fading bot ghost trails.
    const nowMs = this.scene.time.now;
    for (const [id, fade] of this.botGhostFades) {
      const elapsed = nowMs - fade.startMs;
      const fadeT = elapsed / RENDER.trail.ghostFadeOutMs;
      if (fadeT >= 1 || fade.points.length < 2) {
        this.botGhostFades.delete(id);
        continue;
      }
      const k = 1 - fadeT;
      this.drawDashedTrail(
        gfx,
        fade.points,
        RENDER.trail.ghostLineWidth * (0.6 + 0.4 * k),
        fade.color,
        RENDER.trail.ghostAlpha * k,
        RENDER.trail.ghostDashPx,
        RENDER.trail.ghostGapPx,
      );
      this.trailsDirty = true;
    }

  }

  private drawSmoothTrail(
    gfx: Phaser.GameObjects.Graphics,
    pts: Vec2[],
    lineWidth: number,
    color: number,
    alpha: number,
  ): void {
    if (pts.length < 2) return;
    gfx.lineStyle(lineWidth, color, alpha);
    gfx.beginPath();
    const first = pts[0] as Vec2;
    gfx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const pt = pts[i] as Vec2;
      gfx.lineTo(pt.x, pt.y);
    }
    gfx.strokePath();

    // Round joints and caps: Phaser Graphics uses miter-style joins which
    // produce visible spikes/kinks at sharp turns. Fill a circle at each
    // vertex (radius = lineWidth/2) to smooth the seams.
    const r = lineWidth * 0.5;
    gfx.fillStyle(color, alpha);
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i] as Vec2;
      gfx.fillCircle(pt.x, pt.y, r);
    }
  }

  private drawDashedTrail(
    gfx: Phaser.GameObjects.Graphics,
    pts: Vec2[],
    lineWidth: number,
    color: number,
    alpha: number,
    dashPx: number,
    gapPx: number,
  ): void {
    if (pts.length < 2 || dashPx <= 0 || gapPx <= 0) return;
    gfx.lineStyle(lineWidth, color, alpha);

    let drawing = true;
    let need = dashPx;
    let curX = (pts[0] as Vec2).x;
    let curY = (pts[0] as Vec2).y;
    for (let i = 1; i < pts.length; i++) {
      const next = pts[i] as Vec2;
      const dx = next.x - curX;
      const dy = next.y - curY;
      let len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      const ux = dx / len;
      const uy = dy / len;
      while (len > 0) {
        const take = Math.min(len, need);
        const nx = curX + ux * take;
        const ny = curY + uy * take;
        if (drawing) {
          gfx.beginPath();
          gfx.moveTo(curX, curY);
          gfx.lineTo(nx, ny);
          gfx.strokePath();
        }
        curX = nx;
        curY = ny;
        len -= take;
        need -= take;
        if (need <= 0) {
          drawing = !drawing;
          need = drawing ? dashPx : gapPx;
        }
      }
    }
  }

  private renderUnits(): void {
    const gfx = this.unitGfx;
    gfx.clear();

    const hero = this.deps.hero;
    const heroX = hero.pos.x;
    const heroY = hero.pos.y;
    const heroFill = this.deps.heroFill();

    const bots = this.deps.botAI.getAll();

    // Reuse instance array to avoid per-frame allocation.
    const sortedBots = this.botDistCache;
    sortedBots.length = 0;
    for (const b of bots) {
      if (!b.alive) continue;
      sortedBots.push({ bot: b, dist: Math.hypot(b.pos.x - heroX, b.pos.y - heroY) });
    }
    // Sort only when there are more bots than the glow threshold.
    if (sortedBots.length > GLOW_BOT_COUNT) {
      sortedBots.sort((a, b2) => a.dist - b2.dist);
    }

    for (let i = sortedBots.length - 1; i >= 0; i--) {
      const { bot } = sortedBots[i]!;
      const glow = i < GLOW_BOT_COUNT ? PALETTE.botGlowNearest : PALETTE.botGlowFar;
      if (glow > 0) {
        gfx.fillStyle(bot.color, glow * 0.3);
        gfx.fillCircle(bot.pos.x, bot.pos.y, BOT_RADIUS_PX * 2.5);
      }

      const onOwnTerritory = this.deps.territory.isOwnedBy(bot.pos.x, bot.pos.y, bot.id);
      const outlineColor = shadeColor(bot.color, -0.45);

      const triHalf = SPLIT_TRI_HALF * 0.85;
      const triGap = SPLIT_TRI_GAP_MAX * 0.85;
      const offset = BOT_RADIUS_PX + triGap;
      const tx = bot.pos.x + Math.cos(bot.heading) * offset;
      const ty = bot.pos.y + Math.sin(bot.heading) * offset;

      if (onOwnTerritory) {
        this.fillTriangle(gfx, tx, ty, bot.heading, triHalf * 1.45, outlineColor, 0.85);
      }
      this.fillTriangle(gfx, tx, ty, bot.heading, triHalf, bot.color, 0.95);

      gfx.fillStyle(bot.color, 1);
      gfx.fillCircle(bot.pos.x, bot.pos.y, BOT_RADIUS_PX);

      if (onOwnTerritory) {
        gfx.lineStyle(2, outlineColor, 0.85);
        gfx.strokeCircle(bot.pos.x, bot.pos.y, BOT_RADIUS_PX);
      }
    }

    // Bot ghosts — drawn via pooled triangle sprites further down so the
    // anti-aliased silhouette matches the hero ghost.

    if (hero.alive) {
      gfx.fillStyle(heroFill, PALETTE.hero.glow * 0.4);
      gfx.fillCircle(heroX, heroY, HERO_RADIUS_PX * 2.5);
      gfx.fillStyle(heroFill, 1);
      gfx.fillCircle(heroX, heroY, HERO_RADIUS_PX);
    }

    const hl = this.heroHighlightGfx;
    if (hl) {
      hl.clear();
      if (hero.alive) {
        const outline = shadeColor(heroFill, -0.45);
        hl.lineStyle(2, outline, 0.85);
        hl.strokeCircle(heroX, heroY, HERO_RADIUS_PX);
      }
    }

    this.updateTriangleSprites(heroX, heroY);
    this.updateBotGhostSprites();
  }

  /**
   * Pool + position one anti-aliased triangle sprite per active bot ghost so
   * they share the same smooth silhouette as the hero ghost. Sprites are
   * created lazily on first sighting and destroyed when their ghost is gone.
   */
  private updateBotGhostSprites(): void {
    if (!this.scene.textures.exists("triangle")) return;
    const triBase = SPLIT_TRI_HALF * 2.4 * 0.95;
    const outlineScale = 1.35;
    const seen = new Set<number>();
    const now = this.scene.time.now;

    const ensurePair = (
      id: number,
    ): { fill: Phaser.GameObjects.Image; outline: Phaser.GameObjects.Image } => {
      let pair = this.botGhostSprites.get(id);
      if (!pair) {
        const outline = this.scene.add
          .image(0, 0, "triangle")
          .setDepth(DEPTH_UNIT + 0.6);
        const fill = this.scene.add
          .image(0, 0, "triangle")
          .setDepth(DEPTH_UNIT + 1);
        pair = { fill, outline };
        this.botGhostSprites.set(id, pair);
      }
      return pair;
    };

    for (const { ghost, color } of this.deps.botAI.getActiveGhosts()) {
      if (!ghost.alive) continue;
      seen.add(ghost.id);

      const pair = ensurePair(ghost.id);
      const rot = ghost.heading + Math.PI / 2;
      const outlineTint = shadeColor(color, -0.45);
      const sz = triBase;
      const oSz = sz * outlineScale;

      pair.outline.setVisible(true);
      pair.outline.setPosition(ghost.pos.x, ghost.pos.y);
      pair.outline.setRotation(rot);
      pair.outline.setDisplaySize(oSz, oSz);
      pair.outline.setTint(outlineTint);
      pair.outline.setAlpha(0.85);

      pair.fill.setVisible(true);
      pair.fill.setPosition(ghost.pos.x, ghost.pos.y);
      pair.fill.setRotation(rot);
      pair.fill.setDisplaySize(sz, sz);
      pair.fill.setTint(color);
      pair.fill.setAlpha(0.95);
    }

    // Fade-out: scale + alpha decay over ghostFadeOutMs, mirroring hero ghost.
    for (const [id, fade] of this.botGhostFades) {
      if (seen.has(id)) continue;
      const elapsed = now - fade.startMs;
      const k = Math.max(0, 1 - elapsed / RENDER.trail.ghostFadeOutMs);
      if (k <= 0) continue;
      seen.add(id);

      const pair = ensurePair(id);
      const rot = fade.heading + Math.PI / 2;
      const scale = 1 + (1 - k) * 0.6;
      const sz = triBase * scale;
      const oSz = sz * outlineScale;
      const outlineTint = shadeColor(fade.color, -0.45);

      pair.outline.setVisible(true);
      pair.outline.setPosition(fade.pos.x, fade.pos.y);
      pair.outline.setRotation(rot);
      pair.outline.setDisplaySize(oSz, oSz);
      pair.outline.setTint(outlineTint);
      pair.outline.setAlpha(0.85 * k);

      pair.fill.setVisible(true);
      pair.fill.setPosition(fade.pos.x, fade.pos.y);
      pair.fill.setRotation(rot);
      pair.fill.setDisplaySize(sz, sz);
      pair.fill.setTint(fade.color);
      pair.fill.setAlpha(0.95 * k);
    }

    for (const [id, pair] of this.botGhostSprites) {
      if (seen.has(id)) continue;
      pair.fill.destroy();
      pair.outline.destroy();
      this.botGhostSprites.delete(id);
    }
  }

  private fillTriangle(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    heading: number,
    half: number,
    color: number,
    alpha: number,
  ): void {
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const tipX = x + cos * half;
    const tipY = y + sin * half;
    const baseAX = x + (cos * -half * 0.6 - sin * half * 0.85);
    const baseAY = y + (sin * -half * 0.6 + cos * half * 0.85);
    const baseBX = x + (cos * -half * 0.6 + sin * half * 0.85);
    const baseBY = y + (sin * -half * 0.6 - cos * half * 0.85);
    gfx.fillStyle(color, alpha);
    gfx.beginPath();
    gfx.moveTo(tipX, tipY);
    gfx.lineTo(baseAX, baseAY);
    gfx.lineTo(baseBX, baseBY);
    gfx.closePath();
    gfx.fillPath();
  }

  private updateTriangleSprites(heroX: number, heroY: number): void {
    const triBase = SPLIT_TRI_HALF * 2.4;
    const outlineScale = 1.35;
    const hero = this.deps.hero;
    const heroAlive = hero.alive;
    const heroFill = this.deps.heroFill();
    const ghostSys = this.deps.ghostSys();
    const ghost = ghostSys.getActive();
    const ghostFlying = ghost !== null && ghost.alive;
    const now = this.scene.time.now;

    if (this.ghostSprite) {
      if (ghostFlying) {
        const g = ghost!;
        const rot = g.heading + Math.PI / 2;
        this.ghostSprite.setVisible(true);
        this.ghostSprite.setPosition(g.pos.x, g.pos.y);
        this.ghostSprite.setRotation(rot);
        this.ghostSprite.setTint(heroFill);
        this.ghostSprite.setDisplaySize(triBase * 1.05, triBase * 1.05);
        this.ghostSprite.setAlpha(1);

        if (this.ghostOutline) {
          const sz = triBase * 1.05 * outlineScale;
          this.ghostOutline.setVisible(true);
          this.ghostOutline.setPosition(g.pos.x, g.pos.y);
          this.ghostOutline.setRotation(rot);
          this.ghostOutline.setDisplaySize(sz, sz);
          this.ghostOutline.setAlpha(1);
        }
      } else if (this.ghostFade) {
        const elapsed = now - this.ghostFade.startMs;
        const k = Math.max(0, 1 - elapsed / RENDER.trail.ghostFadeOutMs);
        const rot = this.ghostFade.heading + Math.PI / 2;
        const scale = 1 + (1 - k) * 0.6;
        const sz = triBase * 1.05 * scale;

        this.ghostSprite.setVisible(true);
        this.ghostSprite.setPosition(this.ghostFade.pos.x, this.ghostFade.pos.y);
        this.ghostSprite.setRotation(rot);
        this.ghostSprite.setTint(heroFill);
        this.ghostSprite.setDisplaySize(sz, sz);
        this.ghostSprite.setAlpha(k);

        if (this.ghostOutline) {
          this.ghostOutline.setVisible(true);
          this.ghostOutline.setPosition(this.ghostFade.pos.x, this.ghostFade.pos.y);
          this.ghostOutline.setRotation(rot);
          this.ghostOutline.setDisplaySize(sz * outlineScale, sz * outlineScale);
          this.ghostOutline.setAlpha(k);
        }
      } else {
        this.ghostSprite.setDisplaySize(triBase * 1.05, triBase * 1.05);
        this.ghostSprite.setVisible(false);
        this.ghostOutline?.setVisible(false);
      }
    }

    if (this.splitTriSprite) {
      const hide = (): void => {
        this.splitTriSprite?.setVisible(false);
        this.splitTriOutline?.setVisible(false);
      };
      if (!heroAlive || ghostFlying || this.ghostFade) { hide(); return; }
      const ratio = Phaser.Math.Clamp(ghostSys.getCooldownRatio(now), 0, 1);
      if (ratio <= 0.01) { hide(); return; }

      const grow = 1 - (1 - ratio) * (1 - ratio);
      const offset =
        HERO_RADIUS_PX +
        SPLIT_TRI_GAP_MIN +
        (SPLIT_TRI_GAP_MAX - SPLIT_TRI_GAP_MIN) * grow;

      const cx = heroX + Math.cos(hero.heading) * offset;
      const cy = heroY + Math.sin(hero.heading) * offset;

      const sizeFactor = 0.35 + 0.65 * grow;
      const alpha = 0.35 + 0.65 * grow;
      let pulseScale = 1;
      if (ratio >= 1) pulseScale = 1 + 0.06 * Math.sin(now / 180);

      const px = triBase * sizeFactor * pulseScale;
      const rot = hero.heading + Math.PI / 2;

      this.splitTriSprite.setVisible(true);
      this.splitTriSprite.setPosition(cx, cy);
      this.splitTriSprite.setRotation(rot);
      this.splitTriSprite.setDisplaySize(px, px);
      this.splitTriSprite.setAlpha(alpha);
      this.splitTriSprite.setTint(heroFill);

      if (this.splitTriOutline) {
        const oSz = px * outlineScale;
        this.splitTriOutline.setVisible(true);
        this.splitTriOutline.setPosition(cx, cy);
        this.splitTriOutline.setRotation(rot);
        this.splitTriOutline.setDisplaySize(oSz, oSz);
        this.splitTriOutline.setAlpha(alpha);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Task 1: Wave-fill overlay
  // ---------------------------------------------------------------------------

  /**
   * Each frame expand a circle mask from the seed point over waveFillDurationMs.
   * We approximate the "reveal" by drawing the territory color circle-clipped
   * at the growing radius with a slight brightened tint, blended over the static fill.
   */
  private tickWaveFills(_now: number): void {
    const gfx = this.waveFillGfx;
    if (!gfx) return;
    gfx.clear();
    // Wave-fill expanding circle disabled — too noisy visually.
    if (this.waveFills.size > 0) this.waveFills.clear();
  }

  // ---------------------------------------------------------------------------
  // Task 9 phase 1: Bot trail crumble animation
  // ---------------------------------------------------------------------------

  private tickBotTrailFades(now: number): void {
    if (this.botTrailFades.size === 0) return;
    const gfx = this.trailGfx;
    const durationMs = RENDER.botDeath.trailFadeMs;

    for (const [botId, fade] of this.botTrailFades) {
      const elapsed = now - fade.startMs;
      if (elapsed >= durationMs) {
        this.botTrailFades.delete(botId);
        continue;
      }
      const t = elapsed / durationMs;
      const k = 1 - t;
      // Draw fading trail with scatter: offset each point slightly.
      const scatter = t * 6;
      const pts: Vec2[] = fade.points.map((p) => ({
        x: p.x + (Math.random() - 0.5) * scatter,
        y: p.y + (Math.random() - 0.5) * scatter,
      }));
      this.drawSmoothTrail(
        gfx,
        pts,
        RENDER.trail.botLineWidth * (0.5 + 0.5 * k),
        shadeColor(fade.color, RENDER.trailLightenAmount),
        RENDER.trail.botAlpha * k,
      );
      this.trailsDirty = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Task 9 phase 2: Explosion particles + flash
  // ---------------------------------------------------------------------------

  private tickExplosions(now: number): void {
    const gfx = this.explosionGfx;
    if (!gfx) return;
    gfx.clear();
    if (this.explosionParticles.length === 0 && this.deathFlashes.length === 0) {
      this.explosionLastMs = now;
      return;
    }

    const dt = this.explosionLastMs === 0 ? 16 : Math.min(64, now - this.explosionLastMs);
    this.explosionLastMs = now;
    const dtSec = dt / 1000;
    const flashDuration = 180;
    const flashR = RENDER.botDeath.flashRadiusPx;

    // Flash circles.
    for (let i = this.deathFlashes.length - 1; i >= 0; i--) {
      const f = this.deathFlashes[i]!;
      const age = now - f.startMs;
      if (age >= flashDuration) {
        this.deathFlashes.splice(i, 1);
        continue;
      }
      const k = 1 - age / flashDuration;
      gfx.fillStyle(0xffffff, k * 0.8);
      gfx.fillCircle(f.x, f.y, flashR * (1 + (1 - k) * 0.5));
    }

    // Explosion particles.
    for (let i = this.explosionParticles.length - 1; i >= 0; i--) {
      const p = this.explosionParticles[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.explosionParticles[i] = this.explosionParticles[this.explosionParticles.length - 1]!;
        this.explosionParticles.pop();
        continue;
      }
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      const t = p.age / p.life;
      const alpha = (1 - t) * 0.9;
      const r = p.radius * (1 - t * 0.5);
      gfx.fillStyle(p.color, alpha);
      gfx.fillCircle(p.x, p.y, r);
    }
  }

  // ---------------------------------------------------------------------------
  // Task 11: Crown above leader
  // ---------------------------------------------------------------------------

  private tickCrown(now: number): void {
    const img = this.crownImg;
    if (!img) return;

    // Throttle leader search.
    if (now - this.crownLastUpdateMs >= RENDER.crownUpdateMs) {
      this.crownLastUpdateMs = now;
      this.updateCrownLeader();
    }

    if (this.crownOwnerId === 0) {
      img.setVisible(false);
      return;
    }

    // Get current position of the leader.
    const hero = this.deps.hero;
    let pos: Vec2 | null = null;
    if (this.crownOwnerId === hero.id && hero.alive) {
      pos = hero.pos;
    } else {
      const bot = this.botByIdCache.get(this.crownOwnerId);
      if (bot && bot.alive) pos = bot.pos;
    }
    if (!pos) { this.crownOwnerId = 0; img.setVisible(false); return; }

    const floatY = Math.sin(now * 0.002) * RENDER.crownFloatAmp;
    img.setPosition(pos.x, pos.y + RENDER.crownYOffset + floatY);
    img.setVisible(true);
  }

  private updateCrownLeader(): void {
    const polyTerr = this.deps.territory;
    const hero = this.deps.hero;
    let bestId = 0;
    let bestPct = 0;

    const heroPct = polyTerr.getOwnerPercent(hero.id);
    if (heroPct > bestPct) { bestPct = heroPct; bestId = hero.id; }

    for (const bot of this.deps.botAI.getAll()) {
      if (!bot.alive) continue;
      const pct = polyTerr.getOwnerPercent(bot.id);
      if (pct > bestPct) { bestPct = pct; bestId = bot.id; }
    }

    this.crownOwnerId = bestPct > 1 ? bestId : 0;
  }

  // ---------------------------------------------------------------------------
  // Task 14: Trail origin pulse
  // ---------------------------------------------------------------------------

  private tickTrailPulse(_now: number): void {
    const gfx = this.trailPulseGfx;
    if (!gfx) return;
    gfx.clear();
    // Trail-base pulse circle disabled — too noisy visually.
  }
}
