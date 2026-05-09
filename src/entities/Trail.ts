import { RENDER } from "@config/render";
import type { Vec2 } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";

/**
 * Trail of an actor moving outside its own territory.
 * Authoritative source of truth is the world-space polyline.
 */
export class Trail {
  readonly ownerId: OwnerId;
  private _active = false;

  private _polyline: Vec2[] = [];
  private _polylineLen = 0;

  constructor(ownerId: OwnerId) {
    this.ownerId = ownerId;
  }

  get active(): boolean {
    return this._active;
  }

  setActive(value: boolean): void {
    this._active = value;
  }

  clear(): void {
    this._polyline = [];
    this._polylineLen = 0;
    this._active = false;
  }

  /**
   * Append a world-coordinate point to the polyline.
   * No-op if the last point is closer than sampleDistSqPx (squared distance).
   * Caps at RENDER.trail.maxHistoryLen via FIFO shift.
   */
  appendPoint(x: number, y: number, sampleDistSqPx: number): void {
    if (this._polylineLen > 0) {
      const last = this._polyline[this._polylineLen - 1] as Vec2;
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < sampleDistSqPx) return;
    }

    if (this._polylineLen < RENDER.trail.maxHistoryLen) {
      this._polyline.push({ x, y });
      this._polylineLen++;
    } else {
      // FIFO: discard oldest point, append new
      this._polyline.shift();
      this._polyline.push({ x, y });
      // _polylineLen stays at cap
    }
  }

  /** Read-only view of the current polyline points. Live reference — callers that need a snapshot must `.slice()` themselves. */
  getPolyline(): readonly Vec2[] {
    return this._polyline;
  }

  /** Number of points currently in the polyline. */
  polylineLength(): number {
    return this._polylineLen;
  }
}
