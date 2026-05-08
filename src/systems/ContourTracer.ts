/**
 * ContourTracer — pure, Phaser-free.
 * Extracts closed polygon contours for a given owner from a grid ownership map.
 *
 * Uses marching squares on a vertex grid (cols+1) x (rows+1) where each vertex
 * has a binary "filled" flag based on the four surrounding cells. We then stitch
 * segments into closed polylines and optionally smooth them with Chaikin subdivision.
 */

import type { Vec2 } from "@gametypes/geometry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw cell ownership lookup — subset of GridSystem interface. */
export interface OwnerGrid {
  readonly cols: number;
  readonly rows: number;
  ownerOf(cx: number, cy: number): number;
}

// ---------------------------------------------------------------------------
// Marching squares segment tables
// ---------------------------------------------------------------------------

// For a 2x2 cell neighbourhood around a vertex corner we build a 4-bit mask:
//   bit 3 = top-left, bit 2 = top-right, bit 1 = bottom-right, bit 0 = bottom-left
// The 16 cases map to 0, 1 or 2 line segments crossing through the cell square.
// Each segment is defined by two edge midpoints:
//   edge 0 = top (between TL and TR vertices)
//   edge 1 = right (between TR and BR vertices)
//   edge 2 = bottom (between BR and BL vertices)
//   edge 3 = left (between BL and TL vertices)
// Segment table: case -> list of [edgeA, edgeB] pairs.

const SEG_TABLE: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],                         // 0000 — nothing
  [[2, 3]],                   // 0001 — bottom-left
  [[1, 2]],                   // 0010 — bottom-right
  [[1, 3]],                   // 0011 — bottom row
  [[0, 1]],                   // 0100 — top-right
  [[0, 1], [2, 3]],           // 0101 — saddle (ambiguous) — two segs
  [[0, 2]],                   // 0110 — right column
  [[0, 3]],                   // 0111
  [[0, 3]],                   // 1000 — top-left
  [[0, 2]],                   // 1001 — left column
  [[0, 3], [1, 2]],           // 1010 — saddle (ambiguous) — two segs
  [[0, 1]],                   // 1011
  [[1, 3]],                   // 1100 — top row
  [[1, 2]],                   // 1101
  [[2, 3]],                   // 1110
  [],                         // 1111 — fully inside
];

// Edge midpoint offsets relative to cell (cx, cy) in vertex space.
// Vertices are at integer coords; cell (cx,cy) occupies [cx..cx+1, cy..cy+1].
// Edge midpoints (in vertex fractional coords):
//   edge 0 top:    (cx+0.5, cy)
//   edge 1 right:  (cx+1,   cy+0.5)
//   edge 2 bottom: (cx+0.5, cy+1)
//   edge 3 left:   (cx,     cy+0.5)

const EDGE_OFFSET: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.0],   // 0 top
  [1.0, 0.5],   // 1 right
  [0.5, 1.0],   // 2 bottom
  [0.0, 0.5],   // 3 left
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edgeKey(cx: number, cy: number, edge: number): string {
  // Unique string key for an edge midpoint on the grid.
  return `${cx},${cy},${edge}`;
}

function edgeMidpoint(cx: number, cy: number, edge: number, cellPx: number): Vec2 {
  const [ox, oy] = EDGE_OFFSET[edge] as [number, number];
  return { x: (cx + ox) * cellPx, y: (cy + oy) * cellPx };
}

// ---------------------------------------------------------------------------
// Core: extract raw segment soup then stitch into closed polylines
// ---------------------------------------------------------------------------

/**
 * Build a list of directed segment pairs [ptA, ptB] for a single owner.
 * Returns them as pairs for stitching.
 */
function buildSegments(
  grid: OwnerGrid,
  ownerId: number,
  cellPx: number,
): Array<[Vec2, Vec2]> {
  const { cols, rows } = grid;
  const segs: Array<[Vec2, Vec2]> = [];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      // 4-bit bitmask: TL=bit3, TR=bit2, BR=bit1, BL=bit0
      const tl = grid.ownerOf(cx - 1, cy - 1) === ownerId ? 8 : 0;
      const tr = grid.ownerOf(cx,     cy - 1) === ownerId ? 4 : 0;
      const br = grid.ownerOf(cx,     cy)     === ownerId ? 2 : 0;
      const bl = grid.ownerOf(cx - 1, cy)     === ownerId ? 1 : 0;
      const mask = tl | tr | br | bl;

      const table = SEG_TABLE[mask];
      if (!table || table.length === 0) continue;

      for (const [ea, eb] of table) {
        const ptA = edgeMidpoint(cx, cy, ea, cellPx);
        const ptB = edgeMidpoint(cx, cy, eb, cellPx);
        segs.push([ptA, ptB]);
      }
    }
  }

  return segs;
}

/** Round a coordinate to avoid float drift when building adjacency maps. */
function quantize(v: number): number {
  return Math.round(v * 2) / 2; // half-pixel resolution
}

function ptKey(p: Vec2): string {
  return `${quantize(p.x)},${quantize(p.y)}`;
}

/**
 * Stitch raw segments (unordered edge pairs) into closed polylines.
 * Each closed polyline is a Vec2[].
 */
function stitchContours(segs: Array<[Vec2, Vec2]>): Vec2[][] {
  if (segs.length === 0) return [];

  // Build adjacency: for each endpoint, list of segment indices and which end.
  type HalfEdge = { segIdx: number; side: 0 | 1 };
  const adj = new Map<string, HalfEdge[]>();

  const addHalf = (key: string, he: HalfEdge): void => {
    let list = adj.get(key);
    if (!list) { list = []; adj.set(key, list); }
    list.push(he);
  };

  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i] as [Vec2, Vec2];
    addHalf(ptKey(a), { segIdx: i, side: 0 });
    addHalf(ptKey(b), { segIdx: i, side: 1 });
  }

  const used = new Uint8Array(segs.length);
  const contours: Vec2[][] = [];

  for (let startIdx = 0; startIdx < segs.length; startIdx++) {
    if (used[startIdx]) continue;
    used[startIdx] = 1;

    const [sa, sb] = segs[startIdx] as [Vec2, Vec2];
    const poly: Vec2[] = [sa, sb];

    // Walk forward from sb.
    let curPt = sb;
    let prevSegIdx = startIdx;

    for (let guard = 0; guard < segs.length * 2; guard++) {
      const key = ptKey(curPt);
      const neighbors = adj.get(key);
      if (!neighbors) break;

      let advanced = false;
      for (const he of neighbors) {
        if (he.segIdx === prevSegIdx) continue;
        if (used[he.segIdx]) continue;

        used[he.segIdx] = 1;
        const [na, nb] = segs[he.segIdx] as [Vec2, Vec2];
        // nextPt is the OTHER end of this segment.
        const nextPt = he.side === 0 ? nb : na;

        // Check if we've closed back to start.
        if (ptKey(nextPt) === ptKey(poly[0] as Vec2)) {
          // Closed loop — done.
          poly.push(nextPt);
          advanced = true;
          guard = segs.length * 2; // break outer loop
          break;
        }

        poly.push(nextPt);
        curPt = nextPt;
        prevSegIdx = he.segIdx;
        advanced = true;
        break;
      }

      if (!advanced) break;
    }

    if (poly.length >= 3) {
      contours.push(poly);
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Chaikin smoothing
// ---------------------------------------------------------------------------

/**
 * One iteration of Chaikin corner-cutting on a closed polyline.
 * Each edge [P0,P1] produces two new points at 1/4 and 3/4.
 */
function chaikinOnce(pts: Vec2[]): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Vec2;
    const b = pts[(i + 1) % n] as Vec2;
    out.push(
      { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
      { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
    );
  }
  return out;
}

export function chaikinSmooth(pts: Vec2[], iterations: number): Vec2[] {
  let cur = pts;
  for (let i = 0; i < iterations; i++) {
    cur = chaikinOnce(cur);
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract smoothed closed contours for `ownerId` from the grid.
 * Returns an array of closed polylines in world-pixel coordinates.
 */
export function traceContours(
  grid: OwnerGrid,
  ownerId: number,
  cellPx: number,
  smoothIterations: number,
): Vec2[][] {
  const rawSegs = buildSegments(grid, ownerId, cellPx);
  const contours = stitchContours(rawSegs);
  if (smoothIterations <= 0) return contours;
  return contours.map((c) => chaikinSmooth(c, smoothIterations));
}
