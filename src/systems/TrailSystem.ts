import type Phaser from "phaser";
import { Trail } from "@entities/Trail";
import { GameEvents } from "@events/GameEvents";
import type { TrailCellAddedPayload, TrailClosedPayload, TrailCutPayload } from "@gametypes/events";
import type { Vec2 } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";
import type { GridSystem } from "./GridSystem";

/**
 * TrailSystem manages active trails for hero, ghost, and bots.
 *
 * Owner groups: hero and its ghost share the same `groupId` so that
 * hero-trail ↔ ghost-trail intersection triggers loop closure (capture),
 * not a self-cut death. Register pairs via `setPeerGroup`.
 *
 * Loop closure = any of:
 *   - trail A hits trail B where group(A) === group(B)  → trail:closed
 *   - trail A hits own territory cell                   → trail:closed
 *
 * Trail cut (death) = trail A hit by unit from a DIFFERENT group.
 */
export class TrailSystem {
  /** unitId → Trail */
  private trails = new Map<OwnerId, Trail>();

  /**
   * Maps unitId → groupId. Units with the same groupId
   * closing each other's trails triggers capture, not cut.
   */
  private groups = new Map<OwnerId, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly grid: GridSystem,
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
   * Assign unitIds to a shared peer group so hero↔ghost
   * trail intersections trigger closure instead of cut.
   * Call once when a ghost spawns: setPeerGroup(groupId, [heroId, ghostId]).
   */
  setPeerGroup(groupId: number, unitIds: OwnerId[]): void {
    for (const id of unitIds) {
      this.groups.set(id, groupId);
    }
  }

  removeUnit(unitId: OwnerId): void {
    this.trails.delete(unitId);
    this.groups.delete(unitId);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Call each time a unit moves to a new cell while outside its territory.
   * Emits trail:cellAdded.
   * Does NOT check intersections — call checkTrailCollision separately.
   */
  addCellToTrail(unitId: OwnerId, cx: number, cy: number): void {
    const trail = this.ensure(unitId);
    trail.setActive(true);
    trail.addCell(cx, cy);

    const payload: TrailCellAddedPayload = { unitId, cx, cy };
    this.scene.events.emit(GameEvents.TrailCellAdded, payload);
  }

  /**
   * Check whether (cx, cy) collides with any trail or own home territory.
   *
   * Returns the collision kind so the caller can react (e.g. kill unit, start
   * capture). Also emits events.
   *
   * - "none"   — no collision
   * - "closed" — loop closure (same group trail or own territory) → trail:closed
   * - "cut"    — collides with a different-group trail              → trail:cut
   */
  checkTrailCollision(
    unitId: OwnerId,
    cx: number,
    cy: number,
  ): "none" | "closed" | "cut" {
    const myGroup = this.groups.get(unitId) ?? unitId;

    for (const [otherId, otherTrail] of this.trails) {
      if (otherId === unitId) continue;
      if (!otherTrail.active) continue;
      if (!otherTrail.hasCell(cx, cy)) continue;

      const otherGroup = this.groups.get(otherId) ?? otherId;

      if (otherGroup === myGroup) {
        // Same owner group: loop closes → capture territory
        const combinedCells = this.mergeTrailCells(unitId, otherId);
        const payload: TrailClosedPayload = {
          ownerId: unitId,
          cells: combinedCells,
        };
        this.scene.events.emit(GameEvents.TrailClosed, payload);
        return "closed";
      }

      // Different group: stepping ONTO another unit's trail kills its OWNER.
      const payload: TrailCutPayload = { victim: otherId, killer: unitId };
      this.scene.events.emit(GameEvents.TrailCut, payload);
      return "cut";
    }

    // Check own territory: if this cell is already owned by unitId → close loop
    if (this.grid.ownerOf(cx, cy) === unitId) {
      const myTrail = this.trails.get(unitId);
      const cells = myTrail ? myTrail.getCells() : [];
      const payload: TrailClosedPayload = { ownerId: unitId, cells };
      this.scene.events.emit(GameEvents.TrailClosed, payload);
      return "closed";
    }

    return "none";
  }

  /** Clear the trail for a unit (after capture or death). */
  clearTrail(unitId: OwnerId): void {
    this.trails.get(unitId)?.clear();
  }

  get(unitId: OwnerId): Trail | undefined {
    return this.trails.get(unitId);
  }

  // ---------------------------------------------------------------------------
  // Compatibility shims for GhostSystem / BotAI (world-space API)
  // ---------------------------------------------------------------------------

  /**
   * Convert world position to cell, add to trail, and run intersection check.
   * Mirrors the old stub signature used by GhostSystem.
   */
  appendAndTest(owner: OwnerId, pos: Vec2): void {
    const { cx, cy } = this.grid.worldToCell(pos);
    this.addCellToTrail(owner, cx, cy);
    this.checkTrailCollision(owner, cx, cy);
  }

  /** Alias for clearTrail — used by GhostSystem. */
  clear(owner: OwnerId): void {
    this.clearTrail(owner);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Collect packed cells from two trails belonging to the same group.
   * Deduplication via Set.
   */
  private mergeTrailCells(idA: OwnerId, idB: OwnerId): number[] {
    const seen = new Set<number>();
    const result: number[] = [];

    const push = (cells: readonly number[]): void => {
      for (const c of cells) {
        if (!seen.has(c)) {
          seen.add(c);
          result.push(c);
        }
      }
    };

    const a = this.trails.get(idA);
    const b = this.trails.get(idB);
    if (a) push(a.getCells());
    if (b) push(b.getCells());
    return result;
  }
}
