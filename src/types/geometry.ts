export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CellCoord {
  cx: number;
  cy: number;
}

/** Axis-aligned bounding box. */
export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Tuple form for polygon-clipping interop: [x, y]. */
export type Pair = [number, number];

/** Closed (or implicitly closed) ring of vertices. */
export type Ring = Pair[];

/** Polygon = [outerRing, ...holeRings]. polygon-clipping convention: outer CCW, holes CW. */
export type Polygon = Ring[];

/** Set of disjoint polygons. */
export type MultiPolygon = Polygon[];
