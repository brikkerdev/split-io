import { describe, it, expect } from "vitest";
import { traceContours, chaikinSmooth } from "../src/systems/ContourTracer";
import type { OwnerGrid } from "../src/systems/ContourTracer";

// Minimal grid stub.
function makeGrid(cols: number, rows: number, cells: number[][]): OwnerGrid {
  return {
    cols,
    rows,
    ownerOf(cx: number, cy: number): number {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return 0;
      return cells[cy]?.[cx] ?? 0;
    },
  };
}

describe("traceContours", () => {
  it("returns empty for no owned cells", () => {
    const grid = makeGrid(4, 4, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const result = traceContours(grid, 1, 32, 0);
    expect(result).toHaveLength(0);
  });

  it("returns at least one contour for a 3x3 filled block", () => {
    const grid = makeGrid(5, 5, [
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const result = traceContours(grid, 1, 32, 0);
    expect(result.length).toBeGreaterThan(0);
    // Each contour should have at least 3 points.
    for (const poly of result) {
      expect(poly.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("contour points are in world-px space (scaled by cellPx)", () => {
    const cellPx = 32;
    const grid = makeGrid(3, 3, [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    const result = traceContours(grid, 1, cellPx, 0);
    expect(result.length).toBeGreaterThan(0);
    // All points should be multiples of 0.5 * cellPx (edge midpoints).
    for (const poly of result) {
      for (const pt of poly) {
        expect(pt.x % (cellPx * 0.5)).toBeCloseTo(0, 5);
        expect(pt.y % (cellPx * 0.5)).toBeCloseTo(0, 5);
      }
    }
  });

  it("two separate regions produce at least two contours", () => {
    const grid = makeGrid(7, 3, [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    const result = traceContours(grid, 1, 32, 0);
    // Two isolated single-cell blobs → two contours.
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("chaikinSmooth", () => {
  it("returns same array when fewer than 3 points", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const result = chaikinSmooth(pts, 2);
    expect(result).toEqual(pts);
  });

  it("doubles point count each iteration", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const r1 = chaikinSmooth(pts, 1);
    expect(r1).toHaveLength(pts.length * 2);
    const r2 = chaikinSmooth(pts, 2);
    expect(r2).toHaveLength(pts.length * 4);
  });

  it("output points are between input points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = chaikinSmooth(pts, 1);
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});
