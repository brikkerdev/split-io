import { GRID } from "./grid";

const worldW = GRID.cols * GRID.cellPx;
const worldH = GRID.rows * GRID.cellPx;

/**
 * Circular play area inscribed in the square grid.
 * Hero/bots/ghost are clamped to stay inside this circle.
 * Cells outside the circle are inert (cannot be claimed, never rendered).
 */
export const MAP = {
  centerX: worldW / 2,
  centerY: worldH / 2,
  /** Inner radius in pixels — hard movement boundary. */
  radiusPx: Math.min(worldW, worldH) / 2 - GRID.cellPx,
  /** Visual border ring width in pixels (3D edge effect). */
  borderWidthPx: 28,
} as const;

export type MapConfig = typeof MAP;
