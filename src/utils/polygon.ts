import polygonClipping from "polygon-clipping";
import type { Bbox, MultiPolygon, Pair, Polygon, Ring, Vec2 } from "@gametypes/geometry";

// ---------------------------------------------------------------------------
// Boolean ops (thin wrappers over polygon-clipping with empty-input fast paths)
// ---------------------------------------------------------------------------

export function union(...mps: MultiPolygon[]): MultiPolygon {
  if (mps.length === 0) return [];
  const filtered = mps.filter((m) => m.length > 0);
  if (filtered.length === 0) return [];
  if (filtered.length === 1) return filtered[0] as MultiPolygon;
  const [first, ...rest] = filtered;
  return polygonClipping.union(first as MultiPolygon, ...rest);
}

export function difference(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  if (a.length === 0) return [];
  if (b.length === 0) return a;
  return polygonClipping.difference(a, b);
}

export function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  if (a.length === 0 || b.length === 0) return [];
  return polygonClipping.intersection(a, b);
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

/** Signed shoelace area: positive for CCW, negative for CW. */
export function ringSignedArea(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = ring[i] as Pair;
    const pj = ring[j] as Pair;
    sum += pj[0] * pi[1] - pi[0] * pj[1];
  }
  return sum / 2;
}

export function polygonArea(poly: Polygon): number {
  if (poly.length === 0) return 0;
  let area = Math.abs(ringSignedArea(poly[0] as Ring));
  for (let i = 1; i < poly.length; i++) {
    area -= Math.abs(ringSignedArea(poly[i] as Ring));
  }
  return Math.max(0, area);
}

export function multiPolygonArea(mp: MultiPolygon): number {
  let total = 0;
  for (const poly of mp) total += polygonArea(poly);
  return total;
}

// ---------------------------------------------------------------------------
// Bbox
// ---------------------------------------------------------------------------

const EMPTY_BBOX: Bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

export function ringBbox(ring: Ring): Bbox {
  if (ring.length === 0) return { ...EMPTY_BBOX };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function multiPolygonBbox(mp: MultiPolygon): Bbox {
  if (mp.length === 0) return { ...EMPTY_BBOX };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mp) {
    if (poly.length === 0) continue;
    const outer = poly[0] as Ring;
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return { ...EMPTY_BBOX };
  return { minX, minY, maxX, maxY };
}

export function bboxContains(b: Bbox, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

// ---------------------------------------------------------------------------
// Point-in tests (ray casting)
// ---------------------------------------------------------------------------

export function pointInRing(p: Pair, ring: Ring): boolean {
  return pointInRingXY(p[0], p[1], ring);
}

/** Allocation-free variant — avoids the Pair tuple boxing on every call. */
export function pointInRingXY(x: number, y: number, ring: Ring): boolean {
  const n = ring.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = ring[i] as Pair;
    const pj = ring[j] as Pair;
    const xi = pi[0];
    const yi = pi[1];
    const xj = pj[0];
    const yj = pj[1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: Pair, poly: Polygon): boolean {
  return pointInPolygonXY(p[0], p[1], poly);
}

export function pointInPolygonXY(x: number, y: number, poly: Polygon): boolean {
  if (poly.length === 0) return false;
  if (!pointInRingXY(x, y, poly[0] as Ring)) return false;
  for (let i = 1; i < poly.length; i++) {
    if (pointInRingXY(x, y, poly[i] as Ring)) return false;
  }
  return true;
}

export function pointInMultiPolygon(p: Pair, mp: MultiPolygon): boolean {
  return pointInMultiPolygonXY(p[0], p[1], mp);
}

export function pointInMultiPolygonXY(x: number, y: number, mp: MultiPolygon): boolean {
  for (const poly of mp) {
    if (pointInPolygonXY(x, y, poly)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Distance / nearest point
// ---------------------------------------------------------------------------

export function distanceToSegmentSq(p: Pair, a: Pair, b: Pair): number {
  return distanceToSegmentSqXY(p[0], p[1], a[0], a[1], b[0], b[1]);
}

/**
 * Allocation-free variant of distanceToSegmentSq for hot paths.
 * Callers passing scalar coords avoid creating Pair tuples per call.
 */
export function distanceToSegmentSqXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return ddx * ddx + ddy * ddy;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  const ddx = px - cx;
  const ddy = py - cy;
  return ddx * ddx + ddy * ddy;
}

export function nearestPointOnSegment(p: Pair, a: Pair, b: Pair): Pair {
  const px = p[0];
  const py = p[1];
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [ax, ay];
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return [ax + dx * t, ay + dy * t];
}

export function nearestPointOnRing(
  p: Pair,
  ring: Ring,
): { point: Pair; distSq: number } {
  let bestPoint: Pair = [0, 0];
  let bestSq = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j] as Pair;
    const b = ring[i] as Pair;
    const dsq = distanceToSegmentSq(p, a, b);
    if (dsq < bestSq) {
      bestSq = dsq;
      bestPoint = nearestPointOnSegment(p, a, b);
    }
  }
  return { point: bestPoint, distSq: bestSq };
}

export function nearestPointOnMultiPolygon(p: Pair, mp: MultiPolygon): Pair | null {
  let best: Pair | null = null;
  let bestSq = Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      const { point, distSq } = nearestPointOnRing(p, ring);
      if (distSq < bestSq) {
        bestSq = distSq;
        best = point;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Segment intersection
// ---------------------------------------------------------------------------

function ccw(p: Pair, q: Pair, r: Pair): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

/**
 * Strict (non-collinear) segment-segment intersection test.
 * Collinear/touching cases return false — game can tolerate the rare miss
 * and we avoid the floating-point degeneracies of full collinear handling.
 */
export function segmentsIntersect(a1: Pair, a2: Pair, b1: Pair, b2: Pair): boolean {
  const d1 = ccw(b1, b2, a1);
  const d2 = ccw(b1, b2, a2);
  const d3 = ccw(a1, a2, b1);
  const d4 = ccw(a1, a2, b2);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/** Approximate circle as N-segment polygon. Returns [outerRing] (closed). */
export function circlePolygon(
  cx: number,
  cy: number,
  r: number,
  segments = 24,
): Polygon {
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  ring.push(ring[0] as Pair);
  return [ring];
}

/** Convert Vec2[] polyline to Pair[] (for polygon-clipping interop). */
export function polylineToRing(polyline: readonly Vec2[]): Ring {
  const ring: Ring = new Array(polyline.length);
  for (let i = 0; i < polyline.length; i++) {
    const v = polyline[i] as Vec2;
    ring[i] = [v.x, v.y];
  }
  return ring;
}

/**
 * Douglas-Peucker simplification. Removes vertices whose perpendicular
 * deviation from the line of their neighbors is below `tolPx`. Endpoints
 * are preserved.
 */
export function simplifyPolyline(polyline: readonly Vec2[], tolPx: number): Vec2[] {
  const n = polyline.length;
  if (n < 3 || tolPx <= 0) return polyline.map((p) => ({ x: p.x, y: p.y }));
  const tolSq = tolPx * tolPx;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const range = stack.pop() as [number, number];
    const i0 = range[0];
    const i1 = range[1];
    if (i1 <= i0 + 1) continue;
    const a = polyline[i0] as Vec2;
    const b = polyline[i1] as Vec2;
    let bestIdx = -1;
    let bestSq = tolSq;
    for (let k = i0 + 1; k < i1; k++) {
      const p = polyline[k] as Vec2;
      const dsq = distanceToSegmentSq([p.x, p.y], [a.x, a.y], [b.x, b.y]);
      if (dsq > bestSq) {
        bestSq = dsq;
        bestIdx = k;
      }
    }
    if (bestIdx >= 0) {
      keep[bestIdx] = 1;
      stack.push([i0, bestIdx]);
      stack.push([bestIdx, i1]);
    }
  }

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i] === 1) {
      const p = polyline[i] as Vec2;
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/**
 * Minkowski sum of a polyline with a disc of radius `halfWidth` — the
 * canonical "thick stroke" of the polyline. Robust under any polyline
 * shape (sharp turns, self-intersections, near-collinear noise) because
 * each segment contributes a stadium (rect + 2 disc caps) and the union
 * collapses overlaps cleanly.
 *
 * Returns a single `Polygon` (the largest shell of the resulting union).
 * Holes inside the buffered region are dropped — for a captured strip,
 * tiny holes are visual noise.
 */
export function bufferPolyline(
  polyline: readonly Vec2[],
  halfWidth: number,
  capSegments = 10,
): Polygon {
  const n = polyline.length;
  if (n < 1 || halfWidth <= 0) return [];

  const pieces: MultiPolygon[] = [];

  // Disc at every vertex — gives rounded joints and rounded end caps for
  // free, no normals or miter math required.
  for (let i = 0; i < n; i++) {
    const p = polyline[i] as Vec2;
    pieces.push([circlePolygon(p.x, p.y, halfWidth, capSegments)]);
  }

  // Quad along every non-degenerate segment. Skip duplicate consecutive
  // points (zero-length segments would yield a NaN normal).
  for (let i = 0; i < n - 1; i++) {
    const a = polyline[i] as Vec2;
    const b = polyline[i + 1] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nxr = (-dy / len) * halfWidth;
    const nyr = (dx / len) * halfWidth;
    const ring: Ring = [
      [a.x + nxr, a.y + nyr],
      [b.x + nxr, b.y + nyr],
      [b.x - nxr, b.y - nyr],
      [a.x - nxr, a.y - nyr],
      [a.x + nxr, a.y + nyr],
    ];
    pieces.push([[ring]]);
  }

  if (pieces.length === 0) return [];

  const merged = union(...pieces);
  if (merged.length === 0) return [];

  // Pick the largest shell. The union of overlapping stadiums for a
  // connected polyline produces exactly one polygon, but pass through
  // the safety net just in case (e.g. polyline somehow collapsed to
  // disconnected discs after rounding).
  let best = merged[0] as Polygon;
  let bestArea = polygonArea(best);
  for (let i = 1; i < merged.length; i++) {
    const p = merged[i] as Polygon;
    const a = polygonArea(p);
    if (a > bestArea) {
      best = p;
      bestArea = a;
    }
  }
  // Strip holes — inner self-intersection holes look like jagged dots.
  if (best.length > 1) best = [best[0] as Ring];
  return best;
}
