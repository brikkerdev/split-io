import Phaser from "phaser";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { PALETTE } from "@config/palette";
import { RENDER } from "@config/render";
import type { GridSystem } from "@systems/GridSystem";
import type { TrailSystem } from "@systems/TrailSystem";
import type { BotAI } from "@systems/BotAI";
import type { GhostSystem } from "@systems/GhostSystem";
import type { Hero } from "@entities/Hero";
import type { Vec2 } from "@gametypes/geometry";
import { traceContours } from "@systems/ContourTracer";
import { shadeColor } from "@utils/color";

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

export interface RendererDeps {
  grid: GridSystem;
  trails: TrailSystem;
  botAI: BotAI;
  ghostSys: () => GhostSystem;
  hero: Hero;
  heroFill: () => number;
  heroTerritory: () => number;
  heroTrail: () => number;
}

export class GameRenderer {
  private bgGfx!: Phaser.GameObjects.Graphics;
  private territoryGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private unitGfx!: Phaser.GameObjects.Graphics;

  private splitTriSprite?: Phaser.GameObjects.Image;
  private ghostSprite?: Phaser.GameObjects.Image;
  private splitTriOutline?: Phaser.GameObjects.Image;
  private ghostOutline?: Phaser.GameObjects.Image;

  private heroHighlightGfx?: Phaser.GameObjects.Graphics;
  private heroOwnMaskGfx?: Phaser.GameObjects.Graphics;

  private territoryDirty = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: RendererDeps,
  ) {}

  markTerritoryDirty(): void {
    this.territoryDirty = true;
  }

  init(): void {
    this.bgGfx = this.scene.add.graphics().setDepth(DEPTH_BG);
    this.territoryGfx = this.scene.add.graphics().setDepth(DEPTH_TERRITORY);
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
  }

  render(): void {
    if (this.territoryDirty) {
      this.renderTerritory();
      this.territoryDirty = false;
    }
    this.renderTrails();
    this.renderUnits();
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

    const grid = this.deps.grid;
    const cellPx = grid.cellPx;
    const cols = grid.cols;
    const rows = grid.rows;
    const cfg = RENDER.contour;
    const hero = this.deps.hero;
    const heroTerritory = this.deps.heroTerritory();

    const bots = this.deps.botAI.getAll();
    const ownerColor = new Map<number, number>();
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const owner = grid.ownerOf(cx, cy);
        if (owner === 0 || ownerColor.has(owner)) continue;
        let color: number;
        if (owner === hero.id) {
          color = heroTerritory;
        } else {
          const bot = bots.find((b) => b.id === owner);
          color = bot?.color ?? PALETTE.gridLine;
        }
        ownerColor.set(owner, color);
      }
    }

    const ownerContours = new Map<number, Vec2[][]>();
    for (const ownerId of ownerColor.keys()) {
      ownerContours.set(
        ownerId,
        traceContours(grid, ownerId, cellPx, cfg.smoothIterations),
      );
    }

    const traceShape = (
      g: Phaser.GameObjects.Graphics,
      pts: Vec2[],
      offX = 0,
      offY = 0,
    ): void => {
      if (pts.length < 2) return;
      g.beginPath();
      const fp = pts[0] as Vec2;
      g.moveTo(fp.x + offX, fp.y + offY);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i] as Vec2;
        g.lineTo(p.x + offX, p.y + offY);
      }
      g.closePath();
    };

    const shadowOff = cfg.shadowOffsetPx;
    gfx.fillStyle(0x000000, cfg.shadowAlpha);
    for (const contours of ownerContours.values()) {
      for (const poly of contours) {
        if (poly.length < 3) continue;
        traceShape(gfx, poly, shadowOff, shadowOff);
        gfx.fillPath();
      }
    }

    for (const [ownerId, contours] of ownerContours) {
      const color = ownerColor.get(ownerId) ?? PALETTE.gridLine;
      gfx.fillStyle(color, RENDER.territory.fillAlpha);
      for (const poly of contours) {
        if (poly.length < 3) continue;
        traceShape(gfx, poly);
        gfx.fillPath();
      }
    }

    for (const [ownerId, contours] of ownerContours) {
      const color = ownerColor.get(ownerId) ?? PALETTE.gridLine;
      const hiColor = shadeColor(color, cfg.innerHighlightAmount);
      gfx.lineStyle(cfg.innerHighlightWidth, hiColor, cfg.innerHighlightAlpha);
      for (const poly of contours) {
        if (poly.length < 2) continue;
        traceShape(gfx, poly);
        gfx.strokePath();
      }
    }

    for (const [ownerId, contours] of ownerContours) {
      const color = ownerColor.get(ownerId) ?? PALETTE.gridLine;
      const outColor = shadeColor(color, cfg.outerStrokeDarken);
      gfx.lineStyle(cfg.lineWidth, outColor, cfg.alpha);
      for (const poly of contours) {
        if (poly.length < 2) continue;
        traceShape(gfx, poly);
        gfx.strokePath();
      }
    }

    const maskGfx = this.heroOwnMaskGfx;
    if (maskGfx) {
      maskGfx.clear();
      const heroContours = ownerContours.get(hero.id);
      if (heroContours) {
        maskGfx.fillStyle(0xffffff, 1);
        for (const poly of heroContours) {
          if (poly.length < 3) continue;
          traceShape(maskGfx, poly);
          maskGfx.fillPath();
        }
      }
    }
  }

  private renderTrails(): void {
    const gfx = this.trailGfx;
    gfx.clear();

    const hero = this.deps.hero;
    const trails = this.deps.trails;
    const heroTrailColor = this.deps.heroTrail();

    const heroTrail = trails.get(hero.id);
    if (heroTrail && heroTrail.active && hero.posHistory.length > 1) {
      this.drawSmoothTrail(
        gfx,
        hero.posHistory,
        RENDER.trail.heroLineWidth,
        heroTrailColor,
        RENDER.trail.heroAlpha,
      );
    }

    const ghost = this.deps.ghostSys().getActive();
    if (ghost && ghost.alive) {
      const ghostTrail = trails.get(ghost.id);
      if (ghostTrail && ghostTrail.active && ghost.posHistory.length > 1) {
        this.drawSmoothTrail(
          gfx,
          ghost.posHistory,
          RENDER.trail.ghostLineWidth,
          heroTrailColor,
          RENDER.trail.ghostAlpha,
        );
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
        bot.color,
        RENDER.trail.botAlpha,
      );
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
  }

  private renderUnits(): void {
    const gfx = this.unitGfx;
    gfx.clear();

    const hero = this.deps.hero;
    const heroX = hero.pos.x;
    const heroY = hero.pos.y;
    const heroFill = this.deps.heroFill();

    const grid = this.deps.grid;
    const bots = this.deps.botAI.getAll();
    const sortedBots = bots
      .filter((b) => b.alive)
      .map((b) => ({
        bot: b,
        dist: Math.hypot(b.pos.x - heroX, b.pos.y - heroY),
      }))
      .sort((a, b2) => a.dist - b2.dist);

    for (let i = sortedBots.length - 1; i >= 0; i--) {
      const { bot } = sortedBots[i]!;
      const glow = i < GLOW_BOT_COUNT ? PALETTE.botGlowNearest : PALETTE.botGlowFar;
      if (glow > 0) {
        gfx.fillStyle(bot.color, glow * 0.3);
        gfx.fillCircle(bot.pos.x, bot.pos.y, BOT_RADIUS_PX * 2.5);
      }

      const cell = grid.worldToCell(bot.pos);
      const onOwnTerritory = grid.ownerOf(cell.cx, cell.cy) === bot.id;
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
        this.ghostSprite.setAlpha(1);

        if (this.ghostOutline) {
          const sz = triBase * 1.05 * outlineScale;
          this.ghostOutline.setVisible(true);
          this.ghostOutline.setPosition(g.pos.x, g.pos.y);
          this.ghostOutline.setRotation(rot);
          this.ghostOutline.setDisplaySize(sz, sz);
          this.ghostOutline.setAlpha(1);
        }
      } else {
        this.ghostSprite.setVisible(false);
        this.ghostOutline?.setVisible(false);
      }
    }

    if (this.splitTriSprite) {
      const hide = (): void => {
        this.splitTriSprite?.setVisible(false);
        this.splitTriOutline?.setVisible(false);
      };
      if (!heroAlive || ghostFlying) { hide(); return; }
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
}
