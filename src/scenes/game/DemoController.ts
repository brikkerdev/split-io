import type Phaser from "phaser";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import type { GridSystem } from "@systems/GridSystem";
import type { BotAI } from "@systems/BotAI";
import type { TerritorySystem } from "@systems/TerritorySystem";

const DEMO_BOT_COUNT = 12;
const DEMO_FAIRNESS_RESET_SEC = 60;
const DEMO_FAIRNESS_PCT_LIMIT = 30;

export interface DemoDeps {
  grid: GridSystem;
  botAI: BotAI;
  territory: TerritorySystem;
  /** Mark renderer's territory layer as dirty. */
  markTerritoryDirty: () => void;
}

export class DemoController {
  private fairnessTimer = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: DemoDeps,
  ) {}

  reset(): void {
    this.fairnessTimer = 0;
  }

  spawnBots(): void {
    this.deps.botAI.spawn({
      count: DEMO_BOT_COUNT,
      passive: false,
      profileWeights: { aggressor: 0.35, tourist: 0.4, hoarder: 0.25 },
    });
  }

  tickFairness(dt: number): void {
    this.fairnessTimer += dt;
    if (this.fairnessTimer < DEMO_FAIRNESS_RESET_SEC) return;
    this.fairnessTimer = 0;
    for (const bot of this.deps.botAI.getAll()) {
      const pct = this.deps.territory.getOwnerPercent(bot.id);
      if (pct > DEMO_FAIRNESS_PCT_LIMIT) {
        this.deps.territory.shrinkOwner(bot.id, 0.4);
      }
    }
    this.deps.markTerritoryDirty();
  }

  scheduleBotRespawn(id: number): void {
    const delayMs = 800 + Math.random() * 1200;
    this.scene.time.delayedCall(delayMs, () => {
      const bot = this.deps.botAI.getAll().find((b) => b.id === id);
      if (!bot || bot.alive) return;
      const cell = this.pickOffscreenSpawnCell();
      this.deps.botAI.respawnAt(id, cell);
      this.deps.markTerritoryDirty();
    });
  }

  /** Random unowned cell inside the play circle, outside the camera view if possible. */
  private pickOffscreenSpawnCell(): { cx: number; cy: number } {
    const grid = this.deps.grid;
    const r = GRID.startTerritoryRadiusCells;
    const cellPx = grid.cellPx;
    const innerR = MAP.radiusPx - (r + 2) * cellPx;
    const view = this.scene.cameras.main.worldView;
    const padPx = cellPx * (r + 1);

    const isOffscreen = (wx: number, wy: number): boolean => {
      return (
        wx < view.x - padPx ||
        wx > view.right + padPx ||
        wy < view.y - padPx ||
        wy > view.bottom + padPx
      );
    };

    const isClear = (cx: number, cy: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ncx = cx + dx;
          const ncy = cy + dy;
          if (!grid.inBounds(ncx, ncy)) continue;
          if (grid.ownerOf(ncx, ncy) !== 0) return false;
        }
      }
      return true;
    };

    for (let attempt = 0; attempt < 80; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * innerR;
      const wx = MAP.centerX + Math.cos(ang) * rad;
      const wy = MAP.centerY + Math.sin(ang) * rad;
      if (!isOffscreen(wx, wy)) continue;
      const { cx, cy } = grid.worldToCell({ x: wx, y: wy });
      if (isClear(cx, cy)) return { cx, cy };
    }
    for (let attempt = 0; attempt < 40; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * innerR;
      const wx = MAP.centerX + Math.cos(ang) * rad;
      const wy = MAP.centerY + Math.sin(ang) * rad;
      const { cx, cy } = grid.worldToCell({ x: wx, y: wy });
      if (isClear(cx, cy)) return { cx, cy };
    }
    return { cx: Math.floor(grid.cols / 2), cy: Math.floor(grid.rows / 2) };
  }
}
