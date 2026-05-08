// Logical grid. Movement is sub-cell, capture is cell-quantized.

export const GRID = {
  cols: 128,
  rows: 128,
  cellPx: 16,
  bgLineEvery: 4,
  bgLineAlpha: 0.14,
  startTerritoryRadiusCells: 3,
} as const;

export type GridConfig = typeof GRID;
