import { GRID } from "@config/grid";
import type { CellCoord, Rect, Vec2 } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";

/**
 * Logical 128x128 ownership map. Movement is sub-cell.
 * 0 = empty, 1 = hero, 2..N = bots.
 */
export class GridSystem {
  readonly cols = GRID.cols;
  readonly rows = GRID.rows;
  readonly cellPx = GRID.cellPx;
  private cells: Uint16Array;

  constructor() {
    this.cells = new Uint16Array(this.cols * this.rows);
  }

  /** World px -> cell coords (clamped to grid bounds). */
  worldToCell(p: Vec2): CellCoord {
    const cx = Math.floor(p.x / this.cellPx);
    const cy = Math.floor(p.y / this.cellPx);
    return {
      cx: Math.max(0, Math.min(this.cols - 1, cx)),
      cy: Math.max(0, Math.min(this.rows - 1, cy)),
    };
  }

  /** Cell coords -> cell-center world px. */
  cellToWorld(c: CellCoord): Vec2 {
    return {
      x: c.cx * this.cellPx + this.cellPx * 0.5,
      y: c.cy * this.cellPx + this.cellPx * 0.5,
    };
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  ownerOf(cx: number, cy: number): OwnerId {
    if (!this.inBounds(cx, cy)) return 0;
    return this.cells[cy * this.cols + cx] ?? 0;
  }

  setOwner(cx: number, cy: number, owner: OwnerId): void {
    if (!this.inBounds(cx, cy)) return;
    this.cells[cy * this.cols + cx] = owner;
  }

  /**
   * Bulk set for capture. `packed` is a flat array of interleaved [cx, cy, ...].
   * Returns the number of cells that changed owner.
   */
  setOwnerBulk(packed: ArrayLike<number>, owner: OwnerId): number {
    let delta = 0;
    const len = packed.length;
    for (let i = 0; i + 1 < len; i += 2) {
      const cx = packed[i] as number;
      const cy = packed[i + 1] as number;
      if (!this.inBounds(cx, cy)) continue;
      const idx = cy * this.cols + cx;
      if (this.cells[idx] !== owner) {
        this.cells[idx] = owner;
        delta++;
      }
    }
    return delta;
  }

  countOwned(owner: OwnerId): number {
    let count = 0;
    const len = this.cells.length;
    for (let i = 0; i < len; i++) {
      if (this.cells[i] === owner) count++;
    }
    return count;
  }

  /**
   * Returns flat packed [cx, cy, cx, cy, ...] for all cells whose center
   * falls inside the given world-space rect.
   */
  getCellsInRect(rect: Rect): number[] {
    const minCx = Math.max(0, Math.floor(rect.x / this.cellPx));
    const minCy = Math.max(0, Math.floor(rect.y / this.cellPx));
    const maxCx = Math.min(this.cols - 1, Math.floor((rect.x + rect.w - 1) / this.cellPx));
    const maxCy = Math.min(this.rows - 1, Math.floor((rect.y + rect.h - 1) / this.cellPx));

    const result: number[] = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        result.push(cx, cy);
      }
    }
    return result;
  }

  /**
   * Iterates over every cell, calling `cb(cx, cy, owner)`.
   * Avoids closure allocation per-cell by using a typed callback.
   */
  forEach(cb: (cx: number, cy: number, owner: OwnerId) => void): void {
    const { cols, rows } = this;
    for (let cy = 0; cy < rows; cy++) {
      const rowOffset = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        cb(cx, cy, this.cells[rowOffset + cx] ?? 0);
      }
    }
  }

  /** Resets all cells to 0 (empty). */
  clear(): void {
    this.cells.fill(0);
  }

  raw(): Uint16Array {
    return this.cells;
  }
}
