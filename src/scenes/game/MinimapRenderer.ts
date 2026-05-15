import Phaser from "phaser";
import { MAP } from "@config/map";
import { PALETTE } from "@config/palette";
import { shadeColor } from "@utils/color";
import type { BotAI } from "@systems/BotAI";
import type { PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";
import type { Hero } from "@entities/Hero";

const SIZE_REF = 200;
const SIZE_MIN = 110;
const SIZE_MAX = 200;
const SIZE_VMIN_RATIO = 0.20;
const ARENA_INSET = 4;
const HERO_DOT_R_REF = 4.2;
const BOT_DOT_R_REF = 3.2;
const DEPTH = 10000;
const ALPHA = 0.38;

function computeSize(w: number, h: number): number {
  const small = Math.min(w, h);
  return Math.round(Math.max(SIZE_MIN, Math.min(SIZE_MAX, small * SIZE_VMIN_RATIO)));
}

export interface MinimapDeps {
  territory: PolygonTerritorySystem;
  botAI: BotAI;
  hero: Hero;
  heroFill: () => number;
  heroTerritory: () => number;
}

export class MinimapRenderer {
  private gfx!: Phaser.GameObjects.Graphics;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private visible = false;
  private resizeBound?: () => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: MinimapDeps,
  ) {}

  init(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    this.gfx = this.scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(DEPTH);
    this.gfx.setVisible(false);

    // Dedicated UI camera at zoom 1 so the minimap is in screen-space pixels.
    this.uiCam = this.scene.cameras.add(0, 0, w, h, false, "minimap-ui");
    this.uiCam.setScroll(0, 0);
    this.uiCam.setZoom(1);
    this.uiCam.transparent = true;
    this.uiCam.setBackgroundColor(0x000000);
    (this.uiCam as unknown as { backgroundColor: { alpha: number } }).backgroundColor.alpha = 0;

    // Main camera shouldn't draw the minimap (would be zoomed/shifted).
    this.scene.cameras.main.ignore(this.gfx);
    // UI camera should ONLY draw the minimap — ignore everything else.
    this.ignoreAllExceptMinimap();

    this.resizeBound = (): void => {
      this.uiCam.setSize(this.scene.scale.width, this.scene.scale.height);
    };
    this.scene.scale.on("resize", this.resizeBound);
  }

  private ignoreAllExceptMinimap(): void {
    const list = this.scene.children.list;
    for (const obj of list) {
      if (obj !== this.gfx) this.uiCam.ignore(obj);
    }
    // New objects added later need to be ignored by the UI cam too.
    this.scene.events.on(
      Phaser.Scenes.Events.ADDED_TO_SCENE,
      (obj: Phaser.GameObjects.GameObject) => {
        if (obj !== this.gfx) this.uiCam.ignore(obj);
      },
    );
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.gfx?.setVisible(v);
  }

  destroy(): void {
    if (this.resizeBound) this.scene.scale.off("resize", this.resizeBound);
    this.gfx?.destroy();
    if (this.uiCam) this.scene.cameras.remove(this.uiCam);
  }

  /** Convert a world-space point to minimap-local space. */
  private worldToMini(
    x: number,
    y: number,
    scale: number,
    cx: number,
    cy: number,
  ): { mx: number; my: number } {
    const mx = (x - MAP.centerX) * scale + cx;
    const my = (y - MAP.centerY) * scale + cy;
    return { mx, my };
  }

  render(): void {
    if (!this.visible) return;
    const gfx = this.gfx;
    if (!gfx) return;

    const screenW = this.scene.scale.width;
    const screenH = this.scene.scale.height;
    const sizePx = computeSize(screenW, screenH);
    const paddingPx = Math.round(sizePx * 0.09);
    const sizeRatio = sizePx / SIZE_REF;
    const heroDotR = HERO_DOT_R_REF * sizeRatio;
    const botDotR = BOT_DOT_R_REF * sizeRatio;
    const x0 = paddingPx;
    const y0 = screenH - paddingPx - sizePx;
    const arenaR = sizePx / 2 - ARENA_INSET * sizeRatio;
    const cx = x0 + sizePx / 2;
    const cy = y0 + sizePx / 2;
    const scale = arenaR / MAP.radiusPx;

    gfx.clear();
    gfx.setPosition(0, 0);
    gfx.setAlpha(ALPHA);

    const outerR = sizePx / 2;

    // Feathered halo
    const haloSteps = 10;
    const haloColor = shadeColor(PALETTE.bg, -0.05);
    for (let i = haloSteps; i >= 1; i--) {
      const t = i / haloSteps;
      const r = arenaR + (outerR - arenaR) * t;
      gfx.fillStyle(haloColor, 0.08 * (1 - t));
      gfx.fillCircle(cx, cy, r);
    }

    // Arena floor background
    gfx.fillStyle(shadeColor(PALETTE.bg, -0.08), 0.55);
    gfx.fillCircle(cx, cy, arenaR + 1);
    gfx.fillStyle(PALETTE.bg, 0.85);
    gfx.fillCircle(cx, cy, arenaR);

    // Territories (filled outer rings, scaled).
    const heroId = this.deps.hero.id;
    const botById = new Map<number, { color: number }>();
    for (const b of this.deps.botAI.getAll()) botById.set(b.id, { color: b.color });

    for (const [ownerId, t] of this.deps.territory.getAllTerritories()) {
      if (t.isEmpty()) continue;
      const color = ownerId === heroId
        ? this.deps.heroTerritory()
        : (botById.get(ownerId)?.color ?? PALETTE.gridLine);
      gfx.fillStyle(color, 0.85);
      for (const polygon of t.multiPolygon) {
        const outer = polygon[0];
        if (!outer || outer.length < 3) continue;
        const fp = outer[0] as [number, number];
        const fm = this.worldToMini(fp[0], fp[1], scale, cx, cy);
        gfx.beginPath();
        gfx.moveTo(fm.mx, fm.my);
        for (let i = 1; i < outer.length; i++) {
          const p = outer[i] as [number, number];
          const m = this.worldToMini(p[0], p[1], scale, cx, cy);
          gfx.lineTo(m.mx, m.my);
        }
        gfx.closePath();
        gfx.fillPath();
      }
    }

    // Re-stamp the halo on top to fade territory bleed past the rim into nothing.
    for (let i = haloSteps; i >= 1; i--) {
      const t = i / haloSteps;
      const r = arenaR + (outerR - arenaR) * t;
      gfx.fillStyle(haloColor, 0.12 * (1 - t));
      gfx.fillCircle(cx, cy, r);
    }

    // Bot dots.
    for (const bot of this.deps.botAI.getAll()) {
      if (!bot.alive) continue;
      const m = this.worldToMini(bot.pos.x, bot.pos.y, scale, cx, cy);
      gfx.fillStyle(shadeColor(bot.color, -0.45), 0.9);
      gfx.fillCircle(m.mx, m.my, botDotR + 0.8 * sizeRatio);
      gfx.fillStyle(bot.color, 1);
      gfx.fillCircle(m.mx, m.my, botDotR);
    }

    // Hero dot — drawn last, slightly larger, with outline.
    const hero = this.deps.hero;
    if (hero.alive) {
      const m = this.worldToMini(hero.pos.x, hero.pos.y, scale, cx, cy);
      const hf = this.deps.heroFill();
      gfx.fillStyle(shadeColor(hf, -0.5), 1);
      gfx.fillCircle(m.mx, m.my, heroDotR + 1.2 * sizeRatio);
      gfx.fillStyle(hf, 1);
      gfx.fillCircle(m.mx, m.my, heroDotR);
    }
  }
}
