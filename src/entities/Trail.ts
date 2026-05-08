import { GRID } from "@config/grid";
import type { OwnerId } from "@gametypes/unit";

/** Encode grid cell to a single number for O(1) Set lookup. */
export function packCell(cx: number, cy: number): number {
  return cy * GRID.cols + cx;
}

/** Decode packed cell back to [cx, cy]. */
export function unpackCell(packed: number): [number, number] {
  const cy = Math.floor(packed / GRID.cols);
  const cx = packed - cy * GRID.cols;
  return [cx, cy];
}

/**
 * Trail of an actor moving outside its own territory.
 * Cells are stored in insertion order (for polygon extraction)
 * and in a Set for O(1) containment queries.
 */
export class Trail {
  readonly ownerId: OwnerId;
  private _cells: number[] = [];
  private _cellSet: Set<number> = new Set();
  private _active = false;

  constructor(ownerId: OwnerId) {
    this.ownerId = ownerId;
  }

  get active(): boolean {
    return this._active;
  }

  setActive(value: boolean): void {
    this._active = value;
  }

  /** Add a grid cell to this trail. Returns false if cell already present. */
  addCell(cx: number, cy: number): boolean {
    const key = packCell(cx, cy);
    if (this._cellSet.has(key)) return false;
    this._cells.push(key);
    this._cellSet.add(key);
    return true;
  }

  /** O(1) containment check. */
  hasCell(cx: number, cy: number): boolean {
    return this._cellSet.has(packCell(cx, cy));
  }

  /** Ordered packed cells (insertion order). */
  getCells(): readonly number[] {
    return this._cells;
  }

  /** Number of cells in trail. */
  get length(): number {
    return this._cells.length;
  }

  clear(): void {
    this._cells = [];
    this._cellSet = new Set();
    this._active = false;
  }
}
