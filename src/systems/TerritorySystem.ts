import type Phaser from "phaser";
import { Territory } from "@entities/Territory";
import { GameEvents } from "@events/GameEvents";
import type { OwnerId } from "@gametypes/unit";
import type { TrailClosedPayload, TerritoryCapturedPayload } from "@gametypes/events";
import type { GridSystem } from "./GridSystem";

/**
 * Flood-fill capture on loop close, area accounting per owner.
 * Triggered by trail:closed event — never runs per frame.
 */
export class TerritorySystem {
  private territories = new Map<OwnerId, Territory>();
  private readonly totalCells: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly grid: GridSystem,
  ) {
    this.totalCells = grid.cols * grid.rows;
    scene.events.on(
      GameEvents.TrailClosed,
      (payload: TrailClosedPayload) => {
        this.claimEnclosedArea(payload.ownerId, payload.cells);
      },
      this,
    );
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TrailClosed, undefined, this);
  }

  private ensure(owner: OwnerId): Territory {
    let t = this.territories.get(owner);
    if (!t) {
      t = new Territory(owner);
      this.territories.set(owner, t);
    }
    return t;
  }

  /**
   * Directly claim a set of cells for owner (e.g. starting territory).
   * Emits territory:claimed (reuses TerritoryCaptured event).
   */
  claimCells(owner: OwnerId, packedCells: readonly number[]): void {
    if (packedCells.length === 0) return;

    const territory = this.ensure(owner);
    const cols: number = this.grid.cols;
    let gained = 0;
    let minCx: number = cols;
    let minCy: number = this.grid.rows;
    let maxCx = 0;
    let maxCy = 0;

    for (const packed of packedCells) {
      const cx = packed % cols;
      const cy = Math.floor(packed / cols);
      const prev = this.grid.ownerOf(cx, cy);
      if (prev !== owner) {
        if (prev !== 0) {
          const prevTerr = this.territories.get(prev);
          if (prevTerr) prevTerr.removeCells(1);
        }
        this.grid.setOwner(cx, cy, owner);
        gained++;
      }
      if (cx < minCx) minCx = cx;
      if (cy < minCy) minCy = cy;
      if (cx > maxCx) maxCx = cx;
      if (cy > maxCy) maxCy = cy;
    }

    if (gained > 0) {
      territory.addCells(gained);
      territory.updateBbox(minCx, minCy, maxCx, maxCy);
      const pct = this.getOwnerPercent(owner);
      const payload: TerritoryCapturedPayload = {
        ownerId: owner,
        cells: gained,
        pct,
      };
      this.scene.events.emit(GameEvents.TerritoryCaptured, payload);
      this.scene.events.emit(GameEvents.TerritoryUpdate, { owner, percent: pct });
    }
  }

  /**
   * Scanline flood-fill enclosed area from loop perimeter.
   * loopPacked: array of cy*cols+cx indices forming the closed loop.
   *
   * Algorithm:
   * 1. Build Set of loop cells.
   * 2. BFS/scanline from every border cell of bounding-box exterior.
   * 3. Cells reachable from border (and not loop cells) = outside.
   * 4. Everything inside bbox not in outside set and not loop = enclosed interior.
   * 5. Claim loop + interior for owner.
   */
  claimEnclosedArea(owner: OwnerId, loopPacked: readonly number[]): void {
    if (loopPacked.length === 0) return;

    const cols: number = this.grid.cols;
    const rows: number = this.grid.rows;
    const loopSet = new Set<number>(loopPacked);

    // Walls = trail loop cells + cells already owned by `owner`.
    // Flood from full grid border so the player's home zone closes the loop.
    const isWall = (cx: number, cy: number): boolean => {
      const packed = cy * cols + cx;
      if (loopSet.has(packed)) return true;
      return this.grid.ownerOf(cx, cy) === owner;
    };

    const outside = new Uint8Array(cols * rows);
    const queue: number[] = [];

    const enqueue = (cx: number, cy: number): void => {
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
      const packed = cy * cols + cx;
      if (outside[packed] === 1) return;
      if (isWall(cx, cy)) return;
      outside[packed] = 1;
      queue.push(packed);
    };

    for (let cx = 0; cx < cols; cx++) {
      enqueue(cx, 0);
      enqueue(cx, rows - 1);
    }
    for (let cy = 1; cy < rows - 1; cy++) {
      enqueue(0, cy);
      enqueue(cols - 1, cy);
    }

    let head = 0;
    while (head < queue.length) {
      const packed = queue[head++] as number;
      const cx = packed % cols;
      const cy = Math.floor(packed / cols);
      enqueue(cx - 1, cy);
      enqueue(cx + 1, cy);
      enqueue(cx, cy - 1);
      enqueue(cx, cy + 1);
    }

    // Anything not flooded and not already owned by `owner` = enclosed → capture.
    const toClaimPacked: number[] = [...loopPacked];
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const packed = cy * cols + cx;
        if (outside[packed] === 1) continue;
        if (loopSet.has(packed)) continue;
        if (this.grid.ownerOf(cx, cy) === owner) continue;
        toClaimPacked.push(packed);
      }
    }

    this.applyCapture(owner, toClaimPacked);
  }

  /** Apply ownership changes and emit events. */
  private applyCapture(owner: OwnerId, packedCells: readonly number[]): void {
    if (packedCells.length === 0) return;

    const cols: number = this.grid.cols;
    const territory = this.ensure(owner);

    const rows: number = this.grid.rows;
    let gained = 0;
    let minCx: number = cols;
    let minCy: number = rows;
    let maxCx = 0;
    let maxCy = 0;

    for (const packed of packedCells) {
      const cx = packed % cols;
      const cy = Math.floor(packed / cols);
      const prev = this.grid.ownerOf(cx, cy);

      if (cx < minCx) minCx = cx;
      if (cy < minCy) minCy = cy;
      if (cx > maxCx) maxCx = cx;
      if (cy > maxCy) maxCy = cy;

      if (prev !== owner) {
        if (prev !== 0) {
          const prevTerr = this.territories.get(prev);
          if (prevTerr) prevTerr.removeCells(1);
        }
        this.grid.setOwner(cx, cy, owner);
        gained++;
      }
    }

    if (gained > 0) {
      territory.addCells(gained);
      territory.updateBbox(minCx, minCy, maxCx, maxCy);

      const pct = this.getOwnerPercent(owner);
      const capturePayload: TerritoryCapturedPayload = {
        ownerId: owner,
        cells: gained,
        pct,
      };
      this.scene.events.emit(GameEvents.TerritoryCaptured, capturePayload);
      this.scene.events.emit(GameEvents.TerritoryUpdate, { owner, percent: pct });
    }
  }

  /** Release all cells owned by `owner` back to neutral (0). Used when a bot dies. */
  releaseOwner(owner: OwnerId): void {
    const t = this.territories.get(owner);
    if (!t || t.cellCount === 0) return;

    const cols = this.grid.cols;
    const rows = this.grid.rows;
    let freed = 0;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (this.grid.ownerOf(cx, cy) === owner) {
          this.grid.setOwner(cx, cy, 0);
          freed++;
        }
      }
    }
    if (freed > 0) {
      t.removeCells(freed);
      this.scene.events.emit(GameEvents.TerritoryUpdate, { owner, percent: 0 });
    }
    this.territories.delete(owner);
  }

  /**
   * Shrink owner's territory to `retainPct` fraction (0–1) of current size.
   * Releases the outermost cells first (sorted by distance from centroid, descending).
   * Emits TerritoryUpdate after.
   */
  shrinkOwner(owner: OwnerId, retainPct: number): void {
    const cols = this.grid.cols;
    const rows = this.grid.rows;

    // Collect all cells for this owner.
    const cells: Array<{ cx: number; cy: number }> = [];
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (this.grid.ownerOf(cx, cy) === owner) {
          cells.push({ cx, cy });
        }
      }
    }

    if (cells.length === 0) return;

    // Centroid.
    let sumX = 0;
    let sumY = 0;
    for (const c of cells) {
      sumX += c.cx;
      sumY += c.cy;
    }
    const centX = sumX / cells.length;
    const centY = sumY / cells.length;

    // Sort descending by distance from centroid (outermost first).
    cells.sort((a, b) => {
      const da = (a.cx - centX) ** 2 + (a.cy - centY) ** 2;
      const db = (b.cx - centX) ** 2 + (b.cy - centY) ** 2;
      return db - da;
    });

    const keepCount = Math.round(cells.length * Math.max(0, Math.min(1, retainPct)));
    const toRelease = cells.length - keepCount;

    if (toRelease <= 0) return;

    const territory = this.territories.get(owner);
    let freed = 0;
    for (let i = 0; i < toRelease; i++) {
      const c = cells[i];
      if (!c) continue;
      this.grid.setOwner(c.cx, c.cy, 0);
      freed++;
    }

    if (freed > 0 && territory) {
      territory.removeCells(freed);
    }

    const pct = this.getOwnerPercent(owner);
    this.scene.events.emit(GameEvents.TerritoryUpdate, { owner, percent: pct });
  }

  getOwnerPercent(owner: OwnerId): number {
    const t = this.territories.get(owner);
    if (!t || this.totalCells === 0) return 0;
    return (t.cellCount / this.totalCells) * 100;
  }

  getTerritory(owner: OwnerId): Territory | undefined {
    return this.territories.get(owner);
  }
}
