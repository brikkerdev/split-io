import type { TrailSystem } from "./TrailSystem";
import type { PolygonTerritorySystem } from "./PolygonTerritorySystem";
import type { OwnerId } from "@gametypes/unit";
import type { Vec2 } from "@gametypes/geometry";

export type StepResult = "none" | "closed" | "cut";

export interface StepOptions {
  /** Pixel forgiveness for collision detection. */
  cutForgivePx?: number;
  /** Sample distance squared for polyline downsampling. */
  sampleDistSqPx: number;
  /** When true, foreign-closure check uses ownerId as homeOwner (ghost case). */
  isForeign?: boolean;
  /** Extra polyline prepended when closing a ghost loop. */
  extraLoopPolyline?: readonly Vec2[];
}

export class TrailMover {
  constructor(
    private readonly trails: TrailSystem,
    private readonly polyTerritory: PolygonTerritorySystem,
  ) {}

  step(
    unitId: OwnerId,
    ownerId: OwnerId,
    oldPos: Vec2,
    newPos: Vec2,
    opts: StepOptions,
  ): StepResult {
    const newOnOwn = this.polyTerritory.isOwnedBy(newPos.x, newPos.y, ownerId);

    const homeOwner = opts.isForeign ? ownerId : undefined;
    const actorPos = opts.cutForgivePx !== undefined ? newPos : undefined;

    if (!newOnOwn) {
      this.trails.addPoint(unitId, newPos.x, newPos.y, opts.sampleDistSqPx);
    }

    return this.trails.checkTrailCollision(
      unitId,
      newPos.x,
      newPos.y,
      homeOwner,
      actorPos,
      opts.cutForgivePx,
      opts.extraLoopPolyline,
      oldPos,
    );
  }
}
