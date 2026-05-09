import { describe, expect, it } from "vitest";
import { Trail } from "@entities/Trail";
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

function makePolyTerritory(ownerMap: Map<string, number> = new Map()) {
  const ownerAt = (x: number, y: number): number =>
    ownerMap.get(`${Math.floor(x / 16)},${Math.floor(y / 16)}`) ?? 0;
  return {
    ownerAt,
    isOwnedBy(x: number, y: number, owner: number): boolean {
      return ownerAt(x, y) === owner;
    },
  };
}

function makeSys(ownerMap?: Map<string, number>) {
  const scene = makeScene();
  const sys = new TrailSystem(scene as never, makePolyTerritory(ownerMap) as never);
  return { scene, sys };
}

// ---------------------------------------------------------------------------
// Trail entity tests
// ---------------------------------------------------------------------------

describe("Trail", () => {
  it("starts empty and inactive", () => {
    const t = new Trail(1);
    expect(t.polylineLength()).toBe(0);
    expect(t.active).toBe(false);
  });

  it("appendPoint adds points", () => {
    const t = new Trail(1);
    t.appendPoint(10, 20, 0);
    expect(t.polylineLength()).toBe(1);
    const pl = t.getPolyline();
    expect(pl[0]).toEqual({ x: 10, y: 20 });
  });

  it("appendPoint respects sampleDist", () => {
    const t = new Trail(1);
    t.appendPoint(0, 0, 100);
    t.appendPoint(5, 0, 100); // dist=25 < 100, skipped
    expect(t.polylineLength()).toBe(1);
    t.appendPoint(20, 0, 100); // dist=400 >= 100, added
    expect(t.polylineLength()).toBe(2);
  });

  it("clear resets all state", () => {
    const t = new Trail(1);
    t.appendPoint(1, 1, 0);
    t.setActive(true);
    t.clear();
    expect(t.polylineLength()).toBe(0);
    expect(t.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TrailSystem — addPoint and rbush segments
// ---------------------------------------------------------------------------

describe("TrailSystem.addPoint", () => {
  it("creates trail and activates it", () => {
    const { sys } = makeSys();
    sys.addPoint(1, 100, 100, 0);
    const trail = sys.get(1);
    expect(trail).toBeDefined();
    expect(trail!.active).toBe(true);
    expect(trail!.polylineLength()).toBe(1);
  });

  it("second point creates an rbush segment (checkCollision can find it)", () => {
    const { sys, scene } = makeSys();
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);

    // Unit 2 steps near the segment of unit 1 — should be cut
    const result = sys.checkCollision(2, 50, 0, 20);
    expect(result).toBe("cut");
    const cutEv = scene._emitted.find((e) => e.event === GameEvents.TrailCut);
    expect(cutEv).toBeDefined();
    const payload = cutEv!.payload as TrailCutPayload;
    expect(payload.victim).toBe(1);
    expect(payload.killer).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TrailSystem.checkCollision
// ---------------------------------------------------------------------------

describe("TrailSystem.checkCollision", () => {
  it("returns none when no segments nearby", () => {
    const { sys, scene } = makeSys();
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);

    const result = sys.checkCollision(2, 500, 500, 20);
    expect(result).toBe("none");
    expect(scene._emitted.filter((e) => e.event === GameEvents.TrailCut)).toHaveLength(0);
  });

  it("same-group segments do not cut each other", () => {
    const { sys } = makeSys();
    sys.setPeerGroup(1, [1, 101]);
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);

    // Unit 101 (same group) steps near unit 1's segment
    const result = sys.checkCollision(101, 50, 0, 20);
    expect(result).toBe("none");
  });

  it("swept motion segment crosses an enemy trail without endpoint near it", () => {
    // Reproduces fast-movement tunneling: actor steps from (50,-100) to (50,100)
    // straight through unit 1's horizontal segment at y=0. Endpoint is far
    // from the segment (radius 5), so the point-distance check alone misses.
    const { sys } = makeSys();
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);

    const result = sys.checkCollision(2, 50, 100, 5, 50, -100);
    expect(result).toBe("cut");
  });

  it("passive trails cannot be cut", () => {
    const { sys } = makeSys();
    sys.addPoint(99, 0, 0, 0);
    sys.addPoint(99, 100, 0, 0);
    sys.setPassive(99, true);

    const result = sys.checkCollision(2, 50, 0, 20);
    expect(result).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// TrailSystem.checkClosure
// ---------------------------------------------------------------------------

describe("TrailSystem.checkClosure", () => {
  it("returns none when not on own territory", () => {
    const { sys } = makeSys();
    sys.addPoint(1, 10, 10, 0);
    const result = sys.checkClosure(1, 500, 500, 1);
    expect(result).toBe("none");
  });

  it("returns none when trail is empty", () => {
    const ownerMap = new Map([["10,10", 1]]);
    const { sys } = makeSys(ownerMap);
    // Do not add any points — trail empty
    const result = sys.checkClosure(1, 168, 168, 1); // 10*16+8=168
    expect(result).toBe("none");
  });

  it("returns closed and emits TrailClosed when on own territory with trail", () => {
    const ownerMap = new Map([["10,10", 1]]);
    const { sys, scene } = makeSys(ownerMap);
    sys.addPoint(1, 50, 50, 0);
    sys.addPoint(1, 100, 50, 0);

    const result = sys.checkClosure(1, 168, 168, 1); // 168=10*16+8
    expect(result).toBe("closed");
    const ev = scene._emitted.find((e) => e.event === GameEvents.TrailClosed);
    expect(ev).toBeDefined();
    const payload = ev!.payload as TrailClosedPayload;
    expect(payload.ownerId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TrailSystem.clearTrail
// ---------------------------------------------------------------------------

describe("TrailSystem.clearTrail", () => {
  it("clears polyline and deactivates trail", () => {
    const { sys } = makeSys();
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);
    sys.clearTrail(1);

    const trail = sys.get(1);
    expect(trail!.polylineLength()).toBe(0);
    expect(trail!.active).toBe(false);
  });

  it("cleared segments no longer trigger cut", () => {
    const { sys } = makeSys();
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);
    sys.clearTrail(1);

    const result = sys.checkCollision(2, 50, 0, 20);
    expect(result).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// TrailSystem.setPeerGroup
// ---------------------------------------------------------------------------

describe("TrailSystem.setPeerGroup", () => {
  it("two different groups cut each other", () => {
    const { sys } = makeSys();
    sys.setPeerGroup(10, [1, 101]);
    sys.setPeerGroup(20, [2, 102]);

    sys.addPoint(2, 0, 0, 0);
    sys.addPoint(2, 100, 0, 0);

    const result = sys.checkCollision(1, 50, 0, 20);
    expect(result).toBe("cut");
  });
});

// ---------------------------------------------------------------------------
// TrailSystem.removeUnit
// ---------------------------------------------------------------------------

describe("TrailSystem.removeUnit", () => {
  it("removes unit segments so they no longer cut", () => {
    const { sys } = makeSys();
    sys.addPoint(1, 0, 0, 0);
    sys.addPoint(1, 100, 0, 0);
    sys.removeUnit(1);

    const result = sys.checkCollision(2, 50, 0, 20);
    expect(result).toBe("none");
    expect(sys.get(1)).toBeUndefined();
  });
});
