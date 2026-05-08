import type { Rect } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";

/** Territory state for one owner. Cell count + cached bounding rect. */
export class Territory {
  readonly owner: OwnerId;
  cellCount = 0;
  /** Bounding rect of owned cells in cell-coords (cx/cy, w/h in cells). */
  bbox: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(owner: OwnerId) {
    this.owner = owner;
  }

  addCells(delta: number): void {
    this.cellCount = Math.max(0, this.cellCount + delta);
  }

  removeCells(delta: number): void {
    this.cellCount = Math.max(0, this.cellCount - delta);
  }

  updateBbox(minCx: number, minCy: number, maxCx: number, maxCy: number): void {
    this.bbox = {
      x: minCx,
      y: minCy,
      w: maxCx - minCx + 1,
      h: maxCy - minCy + 1,
    };
  }
}
