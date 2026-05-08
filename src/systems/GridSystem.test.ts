import { describe, expect, it, beforeEach } from "vitest";
import { GridSystem } from "./GridSystem";
import { GRID } from "../config/grid";

describe("GridSystem", () => {
  let grid: GridSystem;

  beforeEach(() => {
    grid = new GridSystem();
  });

  describe("dimensions", () => {
    it("has correct cols/rows from config", () => {
      expect(grid.cols).toBe(GRID.cols);
      expect(grid.rows).toBe(GRID.rows);
      expect(grid.cellPx).toBe(GRID.cellPx);
    });

    it("raw array length equals cols*rows", () => {
      expect(grid.raw().length).toBe(GRID.cols * GRID.rows);
    });
  });

  describe("set/get owner", () => {
    it("returns 0 for empty cell", () => {
      expect(grid.ownerOf(0, 0)).toBe(0);
    });

    it("sets and gets owner correctly", () => {
      grid.setOwner(5, 10, 3);
      expect(grid.ownerOf(5, 10)).toBe(3);
    });

    it("does not affect adjacent cells", () => {
      grid.setOwner(5, 10, 3);
      expect(grid.ownerOf(4, 10)).toBe(0);
      expect(grid.ownerOf(6, 10)).toBe(0);
      expect(grid.ownerOf(5, 9)).toBe(0);
      expect(grid.ownerOf(5, 11)).toBe(0);
    });

    it("overwrites existing owner", () => {
      grid.setOwner(0, 0, 1);
      grid.setOwner(0, 0, 7);
      expect(grid.ownerOf(0, 0)).toBe(7);
    });
  });

  describe("bounds", () => {
    it("inBounds returns true for valid coords", () => {
      expect(grid.inBounds(0, 0)).toBe(true);
      expect(grid.inBounds(127, 127)).toBe(true);
      expect(grid.inBounds(64, 64)).toBe(true);
    });

    it("inBounds returns false for out-of-range coords", () => {
      expect(grid.inBounds(-1, 0)).toBe(false);
      expect(grid.inBounds(0, -1)).toBe(false);
      expect(grid.inBounds(128, 0)).toBe(false);
      expect(grid.inBounds(0, 128)).toBe(false);
      expect(grid.inBounds(128, 128)).toBe(false);
    });

    it("setOwner ignores out-of-bounds silently", () => {
      expect(() => grid.setOwner(-1, 0, 1)).not.toThrow();
      expect(() => grid.setOwner(0, 200, 1)).not.toThrow();
    });

    it("ownerOf out-of-bounds returns 0", () => {
      expect(grid.ownerOf(-1, 0)).toBe(0);
      expect(grid.ownerOf(0, -1)).toBe(0);
      expect(grid.ownerOf(128, 0)).toBe(0);
      expect(grid.ownerOf(0, 999)).toBe(0);
    });
  });

  describe("worldToCell", () => {
    it("maps origin to cell 0,0", () => {
      const c = grid.worldToCell({ x: 0, y: 0 });
      expect(c.cx).toBe(0);
      expect(c.cy).toBe(0);
    });

    it("maps cellPx-1 to cell 0", () => {
      const c = grid.worldToCell({ x: GRID.cellPx - 1, y: GRID.cellPx - 1 });
      expect(c.cx).toBe(0);
      expect(c.cy).toBe(0);
    });

    it("maps exact cellPx to cell 1", () => {
      const c = grid.worldToCell({ x: GRID.cellPx, y: GRID.cellPx });
      expect(c.cx).toBe(1);
      expect(c.cy).toBe(1);
    });

    it("maps mid-cell correctly", () => {
      const c = grid.worldToCell({ x: GRID.cellPx * 5 + GRID.cellPx / 2, y: GRID.cellPx * 3 });
      expect(c.cx).toBe(5);
      expect(c.cy).toBe(3);
    });

    it("clamps negative coords to 0", () => {
      const c = grid.worldToCell({ x: -100, y: -999 });
      expect(c.cx).toBe(0);
      expect(c.cy).toBe(0);
    });

    it("clamps beyond-grid coords to max cell", () => {
      const c = grid.worldToCell({ x: 999999, y: 999999 });
      expect(c.cx).toBe(GRID.cols - 1);
      expect(c.cy).toBe(GRID.rows - 1);
    });
  });

  describe("cellToWorld", () => {
    it("returns center of cell 0,0", () => {
      const w = grid.cellToWorld({ cx: 0, cy: 0 });
      expect(w.x).toBe(GRID.cellPx * 0.5);
      expect(w.y).toBe(GRID.cellPx * 0.5);
    });

    it("returns center of cell 5,3", () => {
      const w = grid.cellToWorld({ cx: 5, cy: 3 });
      expect(w.x).toBe(5 * GRID.cellPx + GRID.cellPx * 0.5);
      expect(w.y).toBe(3 * GRID.cellPx + GRID.cellPx * 0.5);
    });

    it("worldToCell(cellToWorld(c)) round-trips", () => {
      const original = { cx: 42, cy: 17 };
      const world = grid.cellToWorld(original);
      const back = grid.worldToCell(world);
      expect(back.cx).toBe(original.cx);
      expect(back.cy).toBe(original.cy);
    });
  });

  describe("setOwnerBulk", () => {
    it("sets multiple cells and returns correct delta", () => {
      const packed = [0, 0, 1, 0, 2, 0];
      const delta = grid.setOwnerBulk(packed, 1);
      expect(delta).toBe(3);
      expect(grid.ownerOf(0, 0)).toBe(1);
      expect(grid.ownerOf(1, 0)).toBe(1);
      expect(grid.ownerOf(2, 0)).toBe(1);
    });

    it("does not count cells already owned by same owner", () => {
      grid.setOwner(0, 0, 1);
      const delta = grid.setOwnerBulk([0, 0, 1, 0], 1);
      expect(delta).toBe(1);
    });

    it("skips out-of-bounds entries", () => {
      const delta = grid.setOwnerBulk([-1, 0, 200, 200, 0, 0], 2);
      expect(delta).toBe(1);
      expect(grid.ownerOf(0, 0)).toBe(2);
    });
  });

  describe("countOwned", () => {
    it("returns 0 when no cells owned", () => {
      expect(grid.countOwned(1)).toBe(0);
    });

    it("counts correctly after sets", () => {
      grid.setOwner(0, 0, 1);
      grid.setOwner(1, 0, 1);
      grid.setOwner(2, 0, 2);
      expect(grid.countOwned(1)).toBe(2);
      expect(grid.countOwned(2)).toBe(1);
    });
  });

  describe("getCellsInRect", () => {
    it("returns correct cells for a small rect", () => {
      const result = grid.getCellsInRect({ x: 0, y: 0, w: GRID.cellPx * 2, h: GRID.cellPx });
      expect(result).toEqual([0, 0, 1, 0]);
    });

    it("respects grid bounds (clips negative rect)", () => {
      const result = grid.getCellsInRect({ x: -GRID.cellPx, y: -GRID.cellPx, w: GRID.cellPx * 2, h: GRID.cellPx * 2 });
      expect(result).toContain(0);
    });

    it("returns empty for rect outside grid", () => {
      const result = grid.getCellsInRect({ x: 999999, y: 999999, w: 10, h: 10 });
      expect(result.length).toBe(0);
    });
  });

  describe("forEach", () => {
    it("visits all cells", () => {
      let count = 0;
      grid.forEach(() => { count++; });
      expect(count).toBe(GRID.cols * GRID.rows);
    });

    it("reports correct owner values", () => {
      grid.setOwner(3, 7, 5);
      let found = false;
      grid.forEach((cx, cy, owner) => {
        if (cx === 3 && cy === 7) {
          expect(owner).toBe(5);
          found = true;
        }
      });
      expect(found).toBe(true);
    });
  });

  describe("clear", () => {
    it("resets all cells to 0", () => {
      grid.setOwner(0, 0, 1);
      grid.setOwner(127, 127, 3);
      grid.clear();
      expect(grid.countOwned(1)).toBe(0);
      expect(grid.countOwned(3)).toBe(0);
      expect(grid.ownerOf(0, 0)).toBe(0);
    });
  });
});
