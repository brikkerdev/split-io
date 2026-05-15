import type Phaser from "phaser";
import { BALANCE } from "@config/balance";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import type { GridSystem } from "@systems/GridSystem";
import type { BotAI } from "@systems/BotAI";
import type { PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";

const DEMO_BOT_COUNT = 12;
const DEMO_FAIRNESS_RESET_SEC = 60;
const DEMO_FAIRNESS_PCT_LIMIT = 30;

export interface DemoDeps {
  grid: GridSystem;
  botAI: BotAI;
  territory: PolygonTerritorySystem;
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
      profileWeights: {
        aggressor: 0.28,
        tourist: 0.28,
        hoarder: 0.2,
        carver: 0.14,
        coward: 0.1,
      },
    });
  }

  tickFairness(dt: number): void {
    this.fairnessTimer += dt;
    if (this.fairnessTimer < DEMO_FAIRNESS_RESET_SEC) return;
    this.fairnessTimer = 0;
    for (const bot of this.deps.botAI.getAll()) {
      const pct = this.deps.territory.getOwnerPercent(bot.id);
      if (pct > DEMO_FAIRNESS_PCT_LIMIT) {
        this.deps.territory.shrink(bot.id, 0.4);
      }
    }
    this.deps.markTerritoryDirty();
  }

  scheduleBotRespawn(id: number, delayMsOverride?: number): void {
    const delayMs = delayMsOverride ?? 800 + Math.random() * 1200;
    this.scene.time.delayedCall(delayMs, () => {
      const bot = this.deps.botAI.getAll().find((b) => b.id === id);
      if (!bot || bot.alive) return;

      // Scale active bot count down with map fill: at 50% claimed → ~half
      // the roster respawns; at 100% only the floor remains. Keeps endgame
      // sane instead of spamming bots into shrinking neutral land.
      if (this.aliveBotCount() >= this.targetBotCount()) {
        // Skip this respawn entirely — bot stays dead until fill drops.
        return;
      }

      const cell = this.pickOffscreenSpawnCell();
      if (!cell) {
        // No clear spot; retry later instead of forcing a spawn on owned land.
        this.scheduleBotRespawn(id, 1500 + Math.random() * 1500);
        return;
      }
      this.deps.botAI.respawnAt(id, cell);
      this.deps.markTerritoryDirty();
    });
  }

  private aliveBotCount(): number {
    let n = 0;
    for (const b of this.deps.botAI.getAll()) if (b.alive) n++;
    return n;
  }

  private targetBotCount(): number {
    const claimed = this.deps.territory.getTotalClaimedFraction();
    const total = this.deps.botAI.getAll().length;
    const scaled = Math.ceil(total * (1 - claimed));
    return Math.max(BALANCE.botCountClaimedFloor, scaled);
  }

  /** Random unowned cell inside the play area, outside the camera view if possible. */
  private pickOffscreenSpawnCell(): { cx: number; cy: number } | null {
    const grid = this.deps.grid;
    const territory = this.deps.territory;
    const r = GRID.startTerritoryRadiusCells;
    const cellPx = grid.cellPx;
    const view = this.scene.cameras.main.worldView;
    // Pad the camera rect by the bot's start-territory radius plus a buffer
    // so a freshly spawned bot (and its claimed square) cannot peek into the
    // player's field of view at all.
    const padPx = cellPx * (r + 4);
    const innerR = MAP.radiusPx - (r + 2) * cellPx;
    const probePx = r * cellPx;

    const isOffscreen = (wx: number, wy: number): boolean => {
      return (
        wx < view.x - padPx ||
        wx > view.right + padPx ||
        wy < view.y - padPx ||
        wy > view.bottom + padPx
      );
    };

    // Cheap 5-point sample (center + 4 cardinals at the start-territory radius)
    // instead of scanning every cell in a (2r+1)² block. Good enough to reject
    // overlap with existing territories without the per-call ~50 ownerAt hits.
    const isClear = (wx: number, wy: number): boolean => {
      if (territory.ownerAt(wx, wy) !== 0) return false;
      if (territory.ownerAt(wx + probePx, wy) !== 0) return false;
      if (territory.ownerAt(wx - probePx, wy) !== 0) return false;
      if (territory.ownerAt(wx, wy + probePx) !== 0) return false;
      if (territory.ownerAt(wx, wy - probePx) !== 0) return false;
      return true;
    };

    for (let attempt = 0; attempt < 64; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * Math.max(0, innerR);
      const wx = MAP.centerX + Math.cos(ang) * rad;
      const wy = MAP.centerY + Math.sin(ang) * rad;
      if (!isOffscreen(wx, wy)) continue;
      if (!isClear(wx, wy)) continue;
      const { cx, cy } = grid.worldToCell({ x: wx, y: wy });
      return { cx, cy };
    }
    // Strictly refuse on-screen spawns — the caller will retry later. Better
    // to leave a slot empty for a beat than pop a bot into the player's view.
    return null;
  }
}
