import type { Bbox, MultiPolygon } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";
import {
  bboxContains,
  multiPolygonArea,
  multiPolygonBbox,
  pointInMultiPolygonXY,
} from "@utils/polygon";

/**
 * Polygon-based territory: owner's claimed area as a MultiPolygon.
 * Replaces the legacy grid-cell `Territory` for paper.io 2-style gameplay.
 *
 * Area, bbox, and point-in tests are cached and invalidated only on `set`.
 */
export class PolygonTerritory {
  readonly ownerId: OwnerId;
  multiPolygon: MultiPolygon = [];

  private _area = 0;
  private _bbox: Bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private _dirty = false;

  constructor(ownerId: OwnerId) {
    this.ownerId = ownerId;
  }

  /** Replace the entire MultiPolygon. Marks caches dirty. */
  set(mp: MultiPolygon): void {
    this.multiPolygon = mp;
    this._dirty = true;
  }

  isEmpty(): boolean {
    return this.multiPolygon.length === 0;
  }

  area(): number {
    if (this._dirty) this.refresh();
    return this._area;
  }

  bbox(): Bbox {
    if (this._dirty) this.refresh();
    return this._bbox;
  }

  /** True iff (x, y) lies inside the territory (outer minus holes). */
  containsPoint(x: number, y: number): boolean {
    if (this.multiPolygon.length === 0) return false;
    if (this._dirty) this.refresh();
    if (!bboxContains(this._bbox, x, y)) return false;
    return pointInMultiPolygonXY(x, y, this.multiPolygon);
  }

  private refresh(): void {
    this._area = multiPolygonArea(this.multiPolygon);
    this._bbox =
      this.multiPolygon.length > 0
        ? multiPolygonBbox(this.multiPolygon)
        : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this._dirty = false;
  }
}
