import type Phaser from "phaser";
import RBush from "rbush";
import { Trail } from "@entities/Trail";
import { RENDER } from "@config/render";
import { GameEvents } from "@events/GameEvents";
import type { TrailClosedPayload, TrailCutPayload } from "@gametypes/events";
import type { Vec2 } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";
import type { PolygonTerritorySystem } from "./PolygonTerritorySystem";
import { distanceToSegmentSq, segmentsIntersect } from "@utils/polygon";

// ---------------------------------------------------------------------------
// Segment shape stored in the R-tree
// ---------------------------------------------------------------------------

interface TrailSegment {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  unitId: OwnerId;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function makeSegment(unitId: OwnerId, ax: number, ay: number, bx: number, by: number): TrailSegment {
  return {
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
    unitId,
    ax, ay, bx, by,
  };
}

/**
 * TrailSystem manages active trails for hero, ghost, and bots.
 *
 * Collision detection is segment-based via an R-tree (rbush).
 * Every point appended creates a segment from the previous point; the
 * segment is inserted into the shared R-tree tagged with its unitId.
 *
 * Owner groups: hero and its ghost share the same groupId so that
 * hero-trail <-> ghost-trail intersection triggers loop closure (capture),
 * not a self-cut death. Register pairs via `setPeerGroup`.
 */
export class TrailSystem {
  /** unitId -> Trail */
  private trails = new Map<OwnerId, Trail>();

  /**
   * Maps unitId -> groupId. Units with the same groupId
   * closing each other's trails triggers capture, not cut.
   */
  private groups = new Map<OwnerId, number>();

  /**
   * Trails that other units cannot interact with.
   * Used for ghost trails so enemies can't destroy the ghost by touching its trail.
   */
  private passiveTrails = new Set<OwnerId>();

  /** Shared R-tree for all active trail segments across all units. */
  private rbush = new RBush<TrailSegment>();

  /** Per-unit list of segments currently in the R-tree (for bulk removal on clear). */
  private unitSegments = new Map<OwnerId, TrailSegment[]>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly polyTerritory: PolygonTerritorySystem,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /** Get or create a trail for this unit. */
  ensure(unitId: OwnerId): Trail {
    let t = this.trails.get(unitId);
    if (!t) {
      t = new Trail(unitId);
      this.trails.set(unitId, t);
    }
    return t;
  }

  /**
   * Assign unitIds to a shared peer group so hero<->ghost
   * trail intersections trigger closure instead of cut.
   */
  setPeerGroup(groupId: number, unitIds: OwnerId[]): void {
    for (const id of unitIds) {
      this.groups.set(id, groupId);
    }
  }

  /** Mark a trail so other units stepping on it have no effect. */
  setPassive(unitId: OwnerId, passive: boolean): void {
    if (passive) this.passiveTrails.add(unitId);
    else this.passiveTrails.delete(unitId);
  }

  removeUnit(unitId: OwnerId): void {
    this.removeUnitSegments(unitId);
    this.trails.delete(unitId);
    this.groups.delete(unitId);
    this.passiveTrails.delete(unitId);
    this.unitSegments.delete(unitId);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add a world-space point to the trail for unitId.
   * If the point is far enough from the previous one (past sampleDistSqPx),
   * a segment is inserted into the R-tree.
   */
  addPoint(unitId: OwnerId, x: number, y: number, sampleDistSqPx?: number): void {
    const trail = this.ensure(unitId);
    trail.setActive(true);

    const distSq = sampleDistSqPx ?? RENDER.trail.sampleDistPx * RENDER.trail.sampleDistPx;
    const polyline = trail.getPolyline();
    const last = polyline[polyline.length - 1];

    if (last !== undefined) {
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy >= distSq) {
        const seg = makeSegment(unitId, last.x, last.y, x, y);
        this.rbush.insert(seg);
        let segs = this.unitSegments.get(unitId);
        if (!segs) {
          segs = [];
          this.unitSegments.set(unitId, segs);
        }
        segs.push(seg);
      }
    }

    trail.appendPoint(x, y, distSq);
  }

  /**
   * Check whether the actor's motion (prevX,prevY)→(x,y) with the given radius
   * collides with any OTHER unit's trail segment. Returns "cut" and emits
   * TrailCut if so.
   *
   * Uses both segment-segment intersection (swept against the motion segment)
   * and point-to-segment distance at the destination — without the swept test
   * fast actors tunnel through enemy trails between frames and cuts only
   * register when the per-frame endpoint happens to land near a segment.
   */
  checkCollision(
    unitId: OwnerId,
    x: number,
    y: number,
    radius: number,
    prevX?: number,
    prevY?: number,
  ): "none" | "cut" {
    const myGroup = this.groups.get(unitId) ?? unitId;
    const px = prevX ?? x;
    const py = prevY ?? y;
    const candidates = this.rbush.search({
      minX: Math.min(x, px) - radius,
      minY: Math.min(y, py) - radius,
      maxX: Math.max(x, px) + radius,
      maxY: Math.max(y, py) + radius,
    });

    const hasSweep = px !== x || py !== y;

    for (const seg of candidates) {
      if (seg.unitId === unitId) continue;
      const otherGroup = this.groups.get(seg.unitId) ?? seg.unitId;
      if (otherGroup === myGroup) continue;
      if (this.passiveTrails.has(seg.unitId)) continue;

      let hit = false;

      if (hasSweep) {
        if (segmentsIntersect([px, py], [x, y], [seg.ax, seg.ay], [seg.bx, seg.by])) {
          hit = true;
        }
      }

      if (!hit) {
        const dsq = distanceToSegmentSq([x, y], [seg.ax, seg.ay], [seg.bx, seg.by]);
        if (dsq <= radius * radius) hit = true;
      }

      if (hit) {
        const payload: TrailCutPayload = {
          victim: seg.unitId,
          killer: unitId,
          worldX: x,
          worldY: y,
        };
        this.scene.events.emit(GameEvents.TrailCut, payload);
        return "cut";
      }
    }

    return "none";
  }

  /**
   * Check whether position (x, y) is on the homeOwner's territory while the
   * unit has an active trail — triggers loop closure.
   */
  checkClosure(
    unitId: OwnerId,
    x: number,
    y: number,
    territoryOwner: OwnerId,
    extraLoopPolyline?: readonly Vec2[],
  ): "none" | "closed" {
    if (!this.polyTerritory.isOwnedBy(x, y, territoryOwner)) return "none";

    const trail = this.trails.get(unitId);
    const myPolyline = trail ? trail.getPolyline() : [];
    if (myPolyline.length === 0) return "none";

    let polyline: readonly Vec2[] = myPolyline;
    if (extraLoopPolyline !== undefined && extraLoopPolyline.length > 0) {
      polyline = [...extraLoopPolyline, ...myPolyline];
    }

    const payload: TrailClosedPayload = {
      ownerId: territoryOwner,
      polyline,
      mode: "flood",
      seedX: x,
      seedY: y,
    };
    this.scene.events.emit(GameEvents.TrailClosed, payload);
    return "closed";
  }

  /**
   * Combined collision + closure check. Used by TrailMover and GhostSystem.
   *
   * - "cut"    collision with enemy trail
   * - "closed" re-entered own (or homeOwner's) territory
   * - "none"   nothing
   */
  checkTrailCollision(
    unitId: OwnerId,
    x: number,
    y: number,
    homeOwner?: OwnerId,
    actorPos?: { x: number; y: number },
    cutForgivePx?: number,
    extraLoopPolyline?: readonly Vec2[],
    prevActorPos?: { x: number; y: number },
  ): "none" | "closed" | "cut" {
    const px = actorPos?.x ?? x;
    const py = actorPos?.y ?? y;
    const radius = cutForgivePx ?? RENDER.trail.colliderRadiusPx;
    const home = homeOwner ?? unitId;

    // Closure takes priority over cut only when the actor is re-entering
    // its home with an active trail. Without an active trail there is no
    // closure to protect, so foreign trails laid through the actor's home
    // must still be cuttable by stepping on them.
    const onHome = this.polyTerritory.isOwnedBy(px, py, home);
    if (onHome) {
      const trail = this.trails.get(unitId);
      const hasActiveTrail = trail?.active === true && trail.polylineLength() > 0;
      if (hasActiveTrail) {
        return this.checkClosure(unitId, px, py, home, extraLoopPolyline);
      }
    }

    const cut = this.checkCollision(unitId, px, py, radius, prevActorPos?.x, prevActorPos?.y);
    if (cut === "cut") return "cut";
    return this.checkClosure(unitId, px, py, home, extraLoopPolyline);
  }

  /** Clear the trail for a unit (after capture or death). */
  clearTrail(unitId: OwnerId): void {
    this.removeUnitSegments(unitId);
    const trail = this.trails.get(unitId);
    if (trail) trail.clear();
  }

  /** Alias used by GhostSystem. */
  clear(owner: OwnerId): void {
    this.clearTrail(owner);
  }

  get(unitId: OwnerId): Trail | undefined {
    return this.trails.get(unitId);
  }

  // ---------------------------------------------------------------------------
  // Compatibility shim — world-space add + test (used by GhostSystem / BotAI)
  // ---------------------------------------------------------------------------

  /**
   * Add a world-space point to the trail and immediately run collision + closure check.
   */
  appendAndTest(
    owner: OwnerId,
    pos: Vec2,
    homeOwner?: OwnerId,
    cutForgivePx?: number,
    extraLoopPolyline?: readonly Vec2[],
    prevPos?: Vec2,
  ): "none" | "closed" | "cut" {
    const distSq = RENDER.trail.sampleDistPx * RENDER.trail.sampleDistPx;
    this.addPoint(owner, pos.x, pos.y, distSq);
    return this.checkTrailCollision(
      owner,
      pos.x,
      pos.y,
      homeOwner,
      cutForgivePx !== undefined ? pos : undefined,
      cutForgivePx,
      extraLoopPolyline,
      prevPos,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private removeUnitSegments(unitId: OwnerId): void {
    const segs = this.unitSegments.get(unitId);
    if (!segs || segs.length === 0) return;
    for (const seg of segs) {
      this.rbush.remove(seg, (a, b) => a === b);
    }
    segs.length = 0;
  }
}
