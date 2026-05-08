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
import type { TerritorySystem } from "@systems/TerritorySystem";
import type { GhostSystem } from "@systems/GhostSystem";
import type { BotAI } from "@systems/BotAI";
import type { InputSystem } from "@systems/InputSystem";

export type DeathCause = "trail_cut" | "self_trail";

export interface HeroDeps {
  hero: Hero;
  grid: GridSystem;
  trails: TrailSystem;
  territory: TerritorySystem;
  ghostSys: () => GhostSystem;
  /** Rebuild GhostSystem after a release (returns the new instance). */
  rebuildGhost: () => GhostSystem;
  botAI: BotAI;
  input: InputSystem;
}

export class HeroController {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: HeroDeps,
  ) {}

  spawn(): void {
    const hero = this.deps.hero;
    const grid = this.deps.grid;
    const safe = this.pickRandomSpawnCell();
    const r = GRID.startTerritoryRadiusCells;

    const worldPos = grid.cellToWorld(safe);
    hero.pos = { x: worldPos.x, y: worldPos.y };
    hero.heading = 0;
    hero.alive = true;
    hero.posHistory = [];
    hero.velocity = { x: 0, y: 0 };

    const packed: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ncx = safe.cx + dx;
        const ncy = safe.cy + dy;
        if (!grid.inBounds(ncx, ncy)) continue;
        if (grid.ownerOf(ncx, ncy) !== 0) continue;
        grid.setOwner(ncx, ncy, hero.id);
        packed.push(ncy * grid.cols + ncx);
      }
    }
    this.deps.territory.claimCells(hero.id, packed);
    this.deps.trails.setPeerGroup(hero.id, [hero.id]);
  }

  /** Wipe hero-owned grid + trail + visual + alive flag. Bots untouched. Returns new ghost. */
  release(isFirstRound: boolean): GhostSystem {
    const hero = this.deps.hero;
    this.deps.territory.releaseOwner(hero.id);
    this.deps.trails.clearTrail(hero.id);
    hero.alive = false;
    hero.posHistory = [];
    hero.velocity = { x: 0, y: 0 };
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
    const ghostSys = this.deps.ghostSys();

    const heading = this.deps.input.getDesiredHeading();
    hero.heading = Math.atan2(heading.y, heading.x);

    const cellPx = grid.cellPx;
    const dx = heading.x * hero.speedCellsPerSec * cellPx * dt;
    const dy = heading.y * hero.speedCellsPerSec * cellPx * dt;

    if (dt > 0) {
      hero.velocity.x = dx / dt;
      hero.velocity.y = dy / dt;
    }

    let newX = hero.pos.x + dx;
    let newY = hero.pos.y + dy;

    const ddx = newX - MAP.centerX;
    const ddy = newY - MAP.centerY;
    const distSq = ddx * ddx + ddy * ddy;
    if (distSq > MAP.radiusPx * MAP.radiusPx) {
      const dist = Math.sqrt(distSq);
      const k = MAP.radiusPx / dist;
      newX = MAP.centerX + ddx * k;
      newY = MAP.centerY + ddy * k;
    }

    hero.pos.x = newX;
    hero.pos.y = newY;

    const { cx, cy } = grid.worldToCell(hero.pos);
    const cellOwner = grid.ownerOf(cx, cy);

    if (cellOwner !== hero.id) {
      const heroTrail = trails.get(hero.id);
      if (heroTrail?.active && heroTrail.hasCell(cx, cy)) {
        const cells = heroTrail.getCells();
        const lastPacked = cells[cells.length - 1];
        const curPacked = cy * grid.cols + cx;
        if (lastPacked !== curPacked) {
          return "self_trail";
        }
      }
      trails.addCellToTrail(hero.id, cx, cy);
      const collision = trails.checkTrailCollision(hero.id, cx, cy);

      this.appendPosHistory(newX, newY);

      if (collision === "closed") {
        trails.clearTrail(hero.id);
        hero.posHistory = [];
        ghostSys.onLoopClosed();
      }
    } else {
      const trail = trails.get(hero.id);
      if (trail && trail.active && trail.length > 0) {
        trails.checkTrailCollision(hero.id, cx, cy);
        trails.clearTrail(hero.id);
        hero.posHistory = [];
        ghostSys.onLoopClosed();
      }
    }

    const ghost = ghostSys.getActive();
    if (ghost && ghost.alive) {
      const gCell = grid.worldToCell(ghost.pos);
      if (grid.ownerOf(gCell.cx, gCell.cy) === hero.id) {
        ghostSys.markInHome(dt);
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
    hero.posHistory = [];
    hero.velocity = { x: 0, y: 0 };

    this.deps.trails.clearTrail(hero.id);
    this.deps.territory.shrinkOwner(hero.id, ADS.continueRetainTerritoryPct);
  }

  emitDied(cause: DeathCause): void {
    this.deps.hero.alive = false;
    this.scene.events.emit(GameEvents.PlayerDied, { cause });
  }

  /** Pick a random unowned cell inside the play circle, away from claimed cells. */
  private pickRandomSpawnCell(): { cx: number; cy: number } {
    const grid = this.deps.grid;
    const hero = this.deps.hero;
    const r = GRID.startTerritoryRadiusCells;
    const cols = grid.cols;
    const rows = grid.rows;
    const cellPx = grid.cellPx;
    const innerR = MAP.radiusPx - (r + 2) * cellPx;

    for (let attempt = 0; attempt < 64; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * innerR;
      const wx = MAP.centerX + Math.cos(ang) * rad;
      const wy = MAP.centerY + Math.sin(ang) * rad;
      const { cx, cy } = grid.worldToCell({ x: wx, y: wy });
      if (grid.ownerOf(cx, cy) !== 0) continue;
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r && ok; dx++) {
          const ncx = cx + dx;
          const ncy = cy + dy;
          if (!grid.inBounds(ncx, ncy)) continue;
          const o = grid.ownerOf(ncx, ncy);
          if (o !== 0 && o !== hero.id) ok = false;
        }
      }
      if (ok) return { cx, cy };
    }
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (grid.ownerOf(cx, cy) === 0) return { cx, cy };
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
        if (grid.ownerOf(cx, cy) !== hero.id) continue;

        const wx = cx * grid.cellPx + grid.cellPx * 0.5;
        const wy = cy * grid.cellPx + grid.cellPx * 0.5;

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

  private appendPosHistory(x: number, y: number): void {
    const hist = this.deps.hero.posHistory;
    const last = hist[hist.length - 1];
    if (last !== undefined) {
      const dx = x - last.x;
      const dy = y - last.y;
      const threshold = RENDER.trail.sampleDistPx;
      if (dx * dx + dy * dy < threshold * threshold) return;
    }
    hist.push({ x, y });
    if (hist.length > RENDER.trail.maxHistoryLen) {
      hist.shift();
    }
  }
}
