import { describe, expect, it, vi } from "vitest";
import { TrailMover } from "@systems/TrailMover";
import type { StepOptions } from "@systems/TrailMover";

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

const OPTS: StepOptions = { sampleDistSqPx: 0 };

function makePolyTerritory(ownedCells: Set<string> = new Set()) {
  const ownerAt = (x: number, y: number): number => {
    const key = `${Math.floor(x / 16)},${Math.floor(y / 16)}`;
    return ownedCells.has(key) ? 1 : 0;
  };
  return {
    ownerAt,
    isOwnedBy(x: number, y: number, owner: number): boolean {
      return ownerAt(x, y) === owner;
    },
  };
}

function makeTrails() {
  return {
    addPoint: vi.fn(),
    checkTrailCollision: vi.fn((): "none" | "closed" | "cut" => "none"),
    ensure: vi.fn(() => ({ active: false, polylineLength: () => 0 })),
  };
}

// Helper: cell center at (cx, cy) when cellPx=16
function cellCenter(cx: number, cy: number) {
  return { x: cx * 16 + 8, y: cy * 16 + 8 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TrailMover.step", () => {
  it("own->own does not addPoint but still checks for foreign cuts", () => {
    const owned = new Set(["0,0", "1,0"]);
    const trails = makeTrails();
    const mover = new TrailMover(trails as never, makePolyTerritory(owned) as never);

    const result = mover.step(1, 1, cellCenter(0, 0), cellCenter(1, 0), OPTS);

    expect(result).toBe("none");
    expect(trails.addPoint).not.toHaveBeenCalled();
    expect(trails.checkTrailCollision).toHaveBeenCalled();
  });

  it("exit: addPoint called and checkTrailCollision called", () => {
    const owned = new Set(["0,0"]); // only old cell owned
    const trails = makeTrails();
    const mover = new TrailMover(trails as never, makePolyTerritory(owned) as never);

    const newPos = cellCenter(1, 0);
    mover.step(1, 1, cellCenter(0, 0), newPos, OPTS);

    expect(trails.addPoint).toHaveBeenCalledWith(1, newPos.x, newPos.y, 0);
    expect(trails.checkTrailCollision).toHaveBeenCalled();
  });

  it("re-entry (not outside): checkTrailCollision called, addPoint not called", () => {
    const owned = new Set(["1,0"]); // only new cell owned
    const trails = makeTrails();
    const mover = new TrailMover(trails as never, makePolyTerritory(owned) as never);

    mover.step(1, 1, cellCenter(0, 0), cellCenter(1, 0), OPTS);

    expect(trails.addPoint).not.toHaveBeenCalled();
    expect(trails.checkTrailCollision).toHaveBeenCalled();
  });

  it("re-entry returns closed when checkTrailCollision says closed", () => {
    const owned = new Set(["1,0"]);
    const trails = makeTrails();
    trails.checkTrailCollision.mockReturnValue("closed");
    const mover = new TrailMover(trails as never, makePolyTerritory(owned) as never);

    const result = mover.step(1, 1, cellCenter(0, 0), cellCenter(1, 0), OPTS);
    expect(result).toBe("closed");
  });

  it("continuing outside: addPoint and checkTrailCollision called", () => {
    const trails = makeTrails();
    const mover = new TrailMover(trails as never, makePolyTerritory() as never);

    const newPos = cellCenter(1, 0);
    mover.step(1, 1, cellCenter(0, 0), newPos, OPTS);

    expect(trails.addPoint).toHaveBeenCalledWith(1, newPos.x, newPos.y, 0);
    expect(trails.checkTrailCollision).toHaveBeenCalled();
  });

  it("isForeign passes ownerId as homeOwner to checkTrailCollision", () => {
    const trails = makeTrails();
    const mover = new TrailMover(trails as never, makePolyTerritory() as never);

    mover.step(1, 99, cellCenter(0, 0), cellCenter(1, 0), { ...OPTS, isForeign: true });

    const [, , , homeOwner] = trails.checkTrailCollision.mock.calls[0] as unknown[];
    expect(homeOwner).toBe(99);
  });

  it("cut propagates from checkTrailCollision", () => {
    const trails = makeTrails();
    trails.checkTrailCollision.mockReturnValue("cut");
    const mover = new TrailMover(trails as never, makePolyTerritory() as never);

    const result = mover.step(1, 1, cellCenter(0, 0), cellCenter(1, 0), OPTS);
    expect(result).toBe("cut");
  });
});
