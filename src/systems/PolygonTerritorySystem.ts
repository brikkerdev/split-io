import type Phaser from "phaser";
import { PolygonTerritory } from "@entities/PolygonTerritory";
import { GameEvents } from "@events/GameEvents";
import type { TerritoryCapturedPayload, TrailClosedPayload } from "@gametypes/events";
import type { MultiPolygon, Polygon, Ring, Vec2 } from "@gametypes/geometry";
import type { OwnerId } from "@gametypes/unit";
import { RENDER } from "@config/render";
import {
  bufferPolyline,
  circlePolygon,
  difference,
  intersection,
  multiPolygonArea,
  nearestPointOnMultiPolygon,
  polygonArea,
  polylineToRing,
  simplifyPolyline,
  union,
} from "@utils/polygon";

/** Segments used to approximate the circular arena when clipping claims. */
export const ARENA_DISC_SEGMENTS = 96;

/**
 * Inradius factor of the inscribed regular N-gon used for arenaDisc.
 * The N-gon's edges are chords strictly inside the circle, so the polygon's
 * minimum distance from center is `R * cos(PI/N)`. Hero clamping must respect
 * this or rim positions fall outside the territory polygon — see HeroController.
 */
export const ARENA_DISC_INRADIUS_FACTOR = Math.cos(Math.PI / ARENA_DISC_SEGMENTS);

/**
 * Polygon-based territory system. paper.io 2-style: territory is a MultiPolygon
 * per owner, capture is union, loss is difference, ownership is point-in-polygon.
 *
 * Drop-disconnected-fragments rule: after any boolean op, only the largest
 * polygon shell is kept per owner — disconnected pieces revert to neutral.
 *
 * Phaser scene is optional; pass `null` for headless tests.
 */
export class PolygonTerritorySystem {
  private territories = new Map<OwnerId, PolygonTerritory>();
  private readonly arenaArea: number;
  /** Polygon approximation of the arena disc — claims are clipped to it so the
   *  territory boundary along the rim follows the circle smoothly instead of
   *  showing kinks where straight trail segments crossed the edge. */
  private readonly arenaDisc: MultiPolygon;

  constructor(
    private readonly scene: Phaser.Scene | null,
    arenaRadiusPx: number,
    arenaCenterX: number = arenaRadiusPx,
    arenaCenterY: number = arenaRadiusPx,
  ) {
    this.arenaArea = Math.PI * arenaRadiusPx * arenaRadiusPx;
    this.arenaDisc = [
      circlePolygon(arenaCenterX, arenaCenterY, arenaRadiusPx, ARENA_DISC_SEGMENTS),
    ];
    if (scene !== null) {
      scene.events.on(
        GameEvents.TrailClosed,
        (payload: TrailClosedPayload) => {
          this.claimFromPolyline(payload.ownerId, payload.polyline, payload.seedX, payload.seedY);
        },
        this,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Read API
  // ---------------------------------------------------------------------------

  getTerritory(owner: OwnerId): PolygonTerritory | undefined {
    return this.territories.get(owner);
  }

  /** Owner whose territory contains (x, y), or 0 for neutral. First-match wins. */
  ownerAt(x: number, y: number): OwnerId | 0 {
    for (const t of this.territories.values()) {
      if (t.containsPoint(x, y)) return t.ownerId;
    }
    return 0;
  }

  /**
   * Fast path: test whether (x, y) is owned by a specific owner.
   * Avoids iterating all territories — hot path for BotAI / HeroController
   * which routinely test against their own id.
   */
  isOwnedBy(x: number, y: number, owner: OwnerId): boolean {
    const t = this.territories.get(owner);
    return t !== undefined && t.containsPoint(x, y);
  }

  /** Percentage of arena owned by `owner`. 0 if no territory. */
  getOwnerPercent(owner: OwnerId): number {
    const t = this.territories.get(owner);
    if (!t || this.arenaArea === 0) return 0;
    const pct = (t.area() / this.arenaArea) * 100;
    if (pct <= 0) return 0;
    const inflated = pct + 0.5;
    return inflated >= 100 ? 100 : inflated;
  }

  /** Iterate all active territories. Entries with empty MultiPolygon may be included. */
  getAllTerritories(): ReadonlyMap<OwnerId, PolygonTerritory> {
    return this.territories;
  }

  /** Total fraction of arena claimed across all owners (0..1). */
  getTotalClaimedFraction(): number {
    if (this.arenaArea === 0) return 0;
    let area = 0;
    for (const t of this.territories.values()) area += t.area();
    const f = area / this.arenaArea;
    return f > 1 ? 1 : f < 0 ? 0 : f;
  }

  /** Closest point on owner's territory boundary, or null if empty. */
  getNearestOwnerPoint(owner: OwnerId, from: Vec2): Vec2 | null {
    const t = this.territories.get(owner);
    if (!t || t.isEmpty()) return null;
    const point = nearestPointOnMultiPolygon([from.x, from.y], t.multiPolygon);
    if (point === null) return null;
    return { x: point[0], y: point[1] };
  }

  // ---------------------------------------------------------------------------
  // Write API
  // ---------------------------------------------------------------------------

  /**
   * Claim `polygon` for `owner` (union with existing) and subtract it from
   * every other owner. Drops disconnected fragments per owner. Emits
   * `TerritoryCaptured` for the new owner and `TerritoryUpdate` for every
   * affected owner (including previous ones who lost area).
   */
  claim(owner: OwnerId, polygon: Polygon, seedX?: number, seedY?: number): void {
    if (polygon.length === 0) return;
    let claimMp: MultiPolygon = [polygon];

    // Clip the claim to the arena disc so anything bulging past the rim is
    // trimmed along the circle approximation, not along whatever straight
    // chord the trail polyline happened to draw at the edge.
    try {
      claimMp = intersection(claimMp, this.arenaDisc);
    } catch (e) {
      console.warn("[PolygonTerritorySystem] arena clip failed, skipping", e);
      return;
    }
    if (claimMp.length === 0) return;

    const territory = this.ensure(owner);
    const prevOwnerArea = territory.area();
    let merged: MultiPolygon;
    try {
      merged = union(territory.multiPolygon, claimMp);
    } catch (e) {
      // polygon-clipping throws on degenerate inputs (self-intersections, near-
      // collinear points). Skip this claim rather than crash the game.
      console.warn("[PolygonTerritorySystem] union failed, skipping claim", e);
      return;
    }
    // Fill holes: any enemy/neutral pocket fully enclosed by the owner's outer
    // ring is absorbed. Keeps logical territory in sync with what the renderer
    // actually paints (it draws outer rings only).
    const filled: MultiPolygon = merged.map((poly) => [poly[0] as Ring]);
    territory.set(filled);

    const affected: OwnerId[] = [];
    for (const [otherId, other] of this.territories) {
      if (otherId === owner) continue;
      if (other.isEmpty()) continue;
      const beforeArea = other.area();
      let after: MultiPolygon;
      try {
        after = difference(other.multiPolygon, filled);
      } catch (e) {
        console.warn("[PolygonTerritorySystem] difference failed, skipping subtract", e);
        continue;
      }
      const afterArea = multiPolygonArea(after);
      if (Math.abs(afterArea - beforeArea) > 1e-6) {
        other.set(after);
        affected.push(otherId);
      }
    }

    this.dropFragments(owner);
    for (const id of affected) this.dropFragments(id);

    const newArea = territory.area();
    const gainedArea = Math.max(0, newArea - prevOwnerArea);
    if (gainedArea <= 0 && affected.length === 0) return;

    if (this.scene !== null) {
      const pct = this.getOwnerPercent(owner);
      const gainedPct = this.arenaArea > 0 ? (gainedArea / this.arenaArea) * 100 : 0;
      const capturePayload: TerritoryCapturedPayload = {
        ownerId: owner,
        // Legacy field name; carries area in world-units (px²) now.
        cells: gainedArea,
        pct,
        gainedPct,
        seedX,
        seedY,
      };
      this.scene.events.emit(GameEvents.TerritoryCaptured, capturePayload);
      this.scene.events.emit(GameEvents.TerritoryUpdate, { owner, percent: pct });
      for (const id of affected) {
        this.scene.events.emit(GameEvents.TerritoryUpdate, {
          owner: id,
          percent: this.getOwnerPercent(id),
        });
      }
    }
  }

  /** Drop owner's territory entirely (e.g. on death). */
  release(owner: OwnerId): void {
    const t = this.territories.get(owner);
    if (!t || t.isEmpty()) return;
    t.set([]);
    if (this.scene !== null) {
      this.scene.events.emit(GameEvents.TerritoryUpdate, { owner, percent: 0 });
    }
  }

  /**
   * Shrink owner's territory to keep only `retainPct` (0..1) of its area.
   * Selects the polygon shells with the largest area to preserve. Used for
   * upgrade/death penalties.
   */
  shrink(owner: OwnerId, retainPct: number): void {
    const t = this.territories.get(owner);
    if (!t || t.isEmpty()) return;
    const totalArea = t.area();
    if (totalArea <= 0) return;
    const keepArea = totalArea * Math.max(0, Math.min(1, retainPct));

    const sorted = [...t.multiPolygon].sort(
      (a, b) => polygonArea(b) - polygonArea(a),
    );
    const kept: MultiPolygon = [];
    let acc = 0;
    for (const poly of sorted) {
      if (acc >= keepArea) break;
      kept.push(poly);
      acc += polygonArea(poly);
    }
    t.set(kept);

    if (this.scene !== null) {
      this.scene.events.emit(GameEvents.TerritoryUpdate, {
        owner,
        percent: this.getOwnerPercent(owner),
      });
    }
  }

  destroy(): void {
    if (this.scene !== null) {
      this.scene.events.off(GameEvents.TrailClosed, undefined, this);
    }
    this.territories.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private claimFromPolyline(owner: OwnerId, polyline: readonly Vec2[], seedX?: number, seedY?: number): void {
    if (polyline.length < 2) return;

    // Simplify first to kill micro-jitter that produces lobes/holes when
    // polygon-clipping resolves self-crossings.
    const simplified = simplifyPolyline(polyline, RENDER.trail.captureSimplifyTolPx);
    if (simplified.length < 2) return;

    // Strip along the trail — gives every pass a visible captured thickness
    // even on near-straight runs and smooths over awkward join geometry.
    const strip = bufferPolyline(simplified, RENDER.trail.captureHalfWidthPx, 6);

    let claimMp: MultiPolygon = [];
    if (strip.length > 0) claimMp = [strip];

    // Loop polygon (closed ring) when the trail actually encloses area.
    if (simplified.length >= 3) {
      const ring: Ring = polylineToRing(simplified);
      const first = ring[0] as [number, number];
      const last = ring[ring.length - 1] as [number, number];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
      const loopMp: MultiPolygon = [[ring]];
      claimMp = claimMp.length > 0 ? union(claimMp, loopMp) : loopMp;
    }

    if (claimMp.length === 0) return;
    // Only pass seed to first polygon so one wave-fill spawns per capture event.
    let first = true;
    for (const poly of claimMp) {
      if (poly.length > 0) {
        this.claim(owner, poly, first ? seedX : undefined, first ? seedY : undefined);
        first = false;
      }
    }
  }

  private ensure(owner: OwnerId): PolygonTerritory {
    let t = this.territories.get(owner);
    if (!t) {
      t = new PolygonTerritory(owner);
      this.territories.set(owner, t);
    }
    return t;
  }

  /**
   * Keep only the polygon shell with the largest area. Disconnected fragments
   * (created by carving out a strip) revert to neutral.
   */
  private dropFragments(owner: OwnerId): void {
    const t = this.territories.get(owner);
    if (!t) return;
    const mp = t.multiPolygon;
    if (mp.length <= 1) return;

    let bestIdx = 0;
    let bestArea = polygonArea(mp[0] as Polygon);
    for (let i = 1; i < mp.length; i++) {
      const a = polygonArea(mp[i] as Polygon);
      if (a > bestArea) {
        bestArea = a;
        bestIdx = i;
      }
    }
    t.set([mp[bestIdx] as Polygon]);
  }
}
