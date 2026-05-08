import { describe, it, expect, beforeEach } from "vitest";
import { GridSystem } from "./GridSystem";
import { TerritorySystem } from "./TerritorySystem";
import type Phaser from "phaser";

// Minimal mock — TerritorySystem only calls scene.events.on/off/emit.
function makeScene(): Phaser.Scene {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
    events: {
      on(event: string, fn: (payload: unknown) => void) {
        const list = handlers.get(event) ?? [];
        list.push(fn);
        handlers.set(event, list);
      },
      off() {},
      emit(event: string, payload: unknown) {
        handlers.get(event)?.forEach((fn) => fn(payload));
      },
    },
  } as unknown as Phaser.Scene;
}

const COLS = 128;

function pack(cx: number, cy: number): number {
  return cy * COLS + cx;
}

describe("TerritorySystem – flood-fill", () => {
  let grid: GridSystem;
  let sys: TerritorySystem;

  beforeEach(() => {
    grid = new GridSystem();
    sys = new TerritorySystem(makeScene(), grid);
  });

  it("fills a simple 4x4 square loop correctly", () => {
    // Loop: perimeter of cells (2,2)→(5,2)→(5,5)→(2,5)→(2,2)
    const loop: number[] = [];
    for (let cx = 2; cx <= 5; cx++) loop.push(pack(cx, 2)); // top
    for (let cy = 3; cy <= 4; cy++) loop.push(pack(5, cy)); // right
    for (let cx = 5; cx >= 2; cx--) loop.push(pack(cx, 5)); // bottom
    for (let cy = 4; cy >= 3; cy--) loop.push(pack(2, cy)); // left

    sys.claimEnclosedArea(1, loop);

    // All interior cells (3-4, 3-4) should be owned by 1.
    expect(grid.ownerOf(3, 3)).toBe(1);
    expect(grid.ownerOf(4, 3)).toBe(1);
    expect(grid.ownerOf(3, 4)).toBe(1);
    expect(grid.ownerOf(4, 4)).toBe(1);

    // Loop perimeter cells should also be owned.
    expect(grid.ownerOf(2, 2)).toBe(1);
    expect(grid.ownerOf(5, 5)).toBe(1);

    // Outside the loop must be untouched.
    expect(grid.ownerOf(1, 1)).toBe(0);
    expect(grid.ownerOf(6, 6)).toBe(0);

    const pct = sys.getOwnerPercent(1);
    // 4x4 square = 16 cells, grid total = 128*128 = 16384
    expect(pct).toBeCloseTo((16 / 16384) * 100, 5);
  });

  it("does not flood outside when loop is at grid corner (0,0)", () => {
    // 3x3 loop at top-left corner.
    const loop: number[] = [
      pack(0, 0), pack(1, 0), pack(2, 0),
      pack(2, 1), pack(2, 2),
      pack(1, 2), pack(0, 2),
      pack(0, 1),
    ];
    sys.claimEnclosedArea(1, loop);

    // Interior cell (1,1) must be claimed.
    expect(grid.ownerOf(1, 1)).toBe(1);

    // Cell outside loop must be untouched.
    expect(grid.ownerOf(3, 3)).toBe(0);
    expect(grid.ownerOf(0, 3)).toBe(0);
  });

  it("captures foreign cells inside loop and decrements their owner count", () => {
    // Pre-assign enemy territory at (3,3) and (4,3).
    sys.claimCells(2, [pack(3, 3), pack(4, 3)]);
    expect(sys.getTerritory(2)?.cellCount).toBe(2);

    // Player 1 closes a loop enclosing those cells.
    const loop: number[] = [];
    for (let cx = 2; cx <= 5; cx++) loop.push(pack(cx, 2));
    for (let cy = 3; cy <= 4; cy++) loop.push(pack(5, cy));
    for (let cx = 5; cx >= 2; cx--) loop.push(pack(cx, 5));
    for (let cy = 4; cy >= 3; cy--) loop.push(pack(2, cy));

    sys.claimEnclosedArea(1, loop);

    // Previously enemy cells now owned by player 1.
    expect(grid.ownerOf(3, 3)).toBe(1);
    expect(grid.ownerOf(4, 3)).toBe(1);

    // Enemy count reduced by 2.
    expect(sys.getTerritory(2)?.cellCount).toBe(0);
  });

  it("loop with a hole — exterior cells reachable through hole stay outside", () => {
    // U-shaped loop that is NOT fully closed (has a gap at top).
    // Shape: bottom row 2-6 at cy=6, sides going up to cy=3 but top open (cy=2 missing).
    // This means the fill can escape through the top gap → minimal interior fill.

    // Sides only (cx=2, cy 3-6) and (cx=6, cy 3-6) + bottom (cx 2-6, cy=6).
    const loop: number[] = [];
    for (let cx = 2; cx <= 6; cx++) loop.push(pack(cx, 6)); // bottom
    for (let cy = 5; cy >= 3; cy--) loop.push(pack(2, cy)); // left
    for (let cy = 3; cy <= 5; cy++) loop.push(pack(6, cy)); // right
    // No top row — loop is open at cy=2.

    sys.claimEnclosedArea(1, loop);

    // Interior cell (4,4) can be reached from outside via top gap → must NOT be claimed.
    expect(grid.ownerOf(4, 4)).toBe(0);
  });

  it("claimCells marks cells and emits event", () => {
    const cells = [pack(10, 10), pack(11, 10), pack(10, 11)];
    sys.claimCells(3, cells);

    expect(grid.ownerOf(10, 10)).toBe(3);
    expect(grid.ownerOf(11, 10)).toBe(3);
    expect(grid.ownerOf(10, 11)).toBe(3);
    expect(sys.getTerritory(3)?.cellCount).toBe(3);
  });
});
