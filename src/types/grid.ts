// Logical grid types.

/** 0 = empty, 1 = hero territory, 2..N = bot territories. */
export type CellOwner = number;

export interface CellCoord {
  cx: number;
  cy: number;
}

export interface Vec2 {
  x: number;
  y: number;
}
