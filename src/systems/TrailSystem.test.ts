import { describe, expect, it, vi } from "vitest";
import { Trail, packCell } from "@entities/Trail";
import { TrailSystem } from "@systems/TrailSystem";
import { GameEvents } from "@events/GameEvents";
import type { TrailClosedPayload, TrailCutPayload } from "@gametypes/events";

// ---------------------------------------------------------------------------
// Minimal mocks — no Phaser required
// ---------------------------------------------------------------------------

function makeScene() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    events: {
      emit(event: string, payload?: unknown) {
        emitted.push({ event, payload });
      },
    },
    _emitted: emitted,
  };
}

function makeGrid(ownerMap: Map<number, number> = new Map()) {
  return {
    cols: 128,
    rows: 128,
    cellPx: 16,
    ownerOf(cx: number, cy: number): number {
      return ownerMap.get(packCell(cx, cy)) ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Trail entity tests
// ---------------------------------------------------------------------------

describe("Trail", () => {
  it("starts empty and inactive", () => {
    const t = new Trail(1);
    expect(t.length).toBe(0);
    expect(t.active).toBe(false);
  });

  it("addCell inserts and reports hasCell", () => {
    const t = new Trail(1);
    expect(t.addCell(3, 5)).toBe(true);
    expect(t.hasCell(3, 5)).toBe(true);
    expect(t.length).toBe(1);
  });

  it("addCell returns false on duplicate", () => {
    const t = new Trail(1);
    t.addCell(3, 5);
    expect(t.addCell(3, 5)).toBe(false);
    expect(t.length).toBe(1);
  });

  it("getCells returns insertion-ordered packed values", () => {
    const t = new Trail(1);
    t.addCell(1, 0);
    t.addCell(2, 0);
    expect(t.getCells()).toEqual([packCell(1, 0), packCell(2, 0)]);
  });

  it("clear resets all state", () => {
    const t = new Trail(1);
    t.addCell(1, 1);
    t.setActive(true);
    t.clear();
    expect(t.length).toBe(0);
    expect(t.active).toBe(false);
    expect(t.hasCell(1, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TrailSystem tests
// ---------------------------------------------------------------------------

describe("TrailSystem.addCellToTrail", () => {
  it("creates trail and emits trail:cellAdded", () => {
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid() as never);

    sys.addCellToTrail(1, 4, 7);

    const trail = sys.get(1);
    expect(trail).toBeDefined();
    expect(trail!.hasCell(4, 7)).toBe(true);

    const ev = scene._emitted[0];
    expect(ev?.event).toBe(GameEvents.TrailCellAdded);
    expect(ev?.payload).toMatchObject({ unitId: 1, cx: 4, cy: 7 });
  });
});

describe("TrailSystem.checkTrailCollision", () => {
  it("returns none when no trails overlap", () => {
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid() as never);
    sys.addCellToTrail(1, 1, 1);
    sys.addCellToTrail(2, 5, 5);

    expect(sys.checkTrailCollision(1, 9, 9)).toBe("none");
    expect(scene._emitted.filter((e) => e.event !== GameEvents.TrailCellAdded)).toHaveLength(0);
  });

  it("returns cut and emits trail:cut when hitting enemy trail", () => {
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid() as never);

    // Unit 2 has a trail at (3,3); unit 1 steps onto it
    sys.addCellToTrail(2, 3, 3);

    const result = sys.checkTrailCollision(1, 3, 3);
    expect(result).toBe("cut");

    const cutEv = scene._emitted.find((e) => e.event === GameEvents.TrailCut);
    expect(cutEv).toBeDefined();
    const payload = cutEv!.payload as TrailCutPayload;
    // Walker (1) steps ONTO trail of unit 2 → trail owner (2) dies.
    expect(payload.victim).toBe(2);
    expect(payload.killer).toBe(1);
  });

  it("returns closed and emits trail:closed when hero hits ghost trail (same group)", () => {
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid() as never);

    // Hero (id=1) and ghost (id=101) share group 1
    sys.setPeerGroup(1, [1, 101]);

    sys.addCellToTrail(1, 0, 0);
    sys.addCellToTrail(1, 1, 0);
    sys.addCellToTrail(101, 5, 0);
    sys.addCellToTrail(101, 5, 1);

    // Hero walks into ghost's trail
    const result = sys.checkTrailCollision(1, 5, 0);
    expect(result).toBe("closed");

    const closedEv = scene._emitted.find((e) => e.event === GameEvents.TrailClosed);
    expect(closedEv).toBeDefined();
    const payload = closedEv!.payload as TrailClosedPayload;
    expect(payload.ownerId).toBe(1);
    // Combined cells include both trails
    expect(payload.cells).toContain(packCell(0, 0));
    expect(payload.cells).toContain(packCell(5, 0));
  });

  it("returns closed when unit re-enters own territory", () => {
    // Simulate unit 1 owning cell (10,10)
    const ownerMap = new Map<number, number>();
    ownerMap.set(packCell(10, 10), 1);
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid(ownerMap) as never);

    sys.addCellToTrail(1, 8, 8);
    sys.addCellToTrail(1, 9, 8);

    const result = sys.checkTrailCollision(1, 10, 10);
    expect(result).toBe("closed");

    const closedEv = scene._emitted.find((e) => e.event === GameEvents.TrailClosed);
    expect(closedEv).toBeDefined();
    const payload = closedEv!.payload as TrailClosedPayload;
    expect(payload.ownerId).toBe(1);
  });
});

describe("TrailSystem.clearTrail", () => {
  it("clears cells and deactivates trail", () => {
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid() as never);
    sys.addCellToTrail(1, 2, 2);
    sys.clearTrail(1);

    const trail = sys.get(1);
    expect(trail!.length).toBe(0);
    expect(trail!.active).toBe(false);
  });
});

describe("TrailSystem.setPeerGroup", () => {
  it("two different groups still cut each other", () => {
    const scene = makeScene();
    const sys = new TrailSystem(scene as never, makeGrid() as never);

    sys.setPeerGroup(10, [1, 101]);
    sys.setPeerGroup(20, [2, 102]);

    sys.addCellToTrail(2, 4, 4);

    const result = sys.checkTrailCollision(1, 4, 4);
    expect(result).toBe("cut");
  });
});
