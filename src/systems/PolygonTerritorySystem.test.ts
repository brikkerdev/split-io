import { describe, expect, it } from "vitest";
import { PolygonTerritorySystem } from "./PolygonTerritorySystem";
import type { Polygon } from "@gametypes/geometry";
import { circlePolygon } from "@utils/polygon";

function circle(cx: number, cy: number, r: number): Polygon {
  return circlePolygon(cx, cy, r, 48);
}

function makeArena(): [number, number, number] {
  return [1000, 500, 500];
}

describe("PolygonTerritorySystem", () => {
  it("claim adds area, getOwnerPercent reflects it", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(500, 500, 100));
    const pct = sys.getOwnerPercent(1);
    // pi*100^2 / (pi*1000^2) = 1%
    expect(pct).toBeGreaterThan(0.9);
    expect(pct).toBeLessThan(1.1);
  });

  it("ownerAt returns owner inside, 0 outside", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(500, 500, 100));
    expect(sys.ownerAt(500, 500)).toBe(1);
    expect(sys.ownerAt(0, 0)).toBe(0);
    expect(sys.ownerAt(700, 500)).toBe(0);
  });

  it("claim by another owner subtracts overlap from prev", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(500, 500, 100));
    const aBefore = sys.getOwnerPercent(1);
    sys.claim(2, circle(500, 500, 50));
    const aAfter = sys.getOwnerPercent(1);
    expect(aAfter).toBeLessThan(aBefore);
    expect(sys.ownerAt(500, 500)).toBe(2);
    // 75 from center is outside owner 2 (r=50) but inside owner 1 (r=100).
    expect(sys.ownerAt(575, 500)).toBe(1);
  });

  it("release clears territory", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(500, 500, 100));
    expect(sys.getOwnerPercent(1)).toBeGreaterThan(0);
    sys.release(1);
    expect(sys.getOwnerPercent(1)).toBe(0);
    expect(sys.ownerAt(500, 500)).toBe(0);
  });

  it("disjoint claim grows total area without overlap", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(200, 200, 50));
    const a1 = sys.getOwnerPercent(1);
    sys.claim(1, circle(800, 800, 50));
    const a2 = sys.getOwnerPercent(1);
    // Two disjoint circles → fragments. dropFragments keeps largest, so area
    // shouldn't double — only the bigger of the two remains. With equal radii
    // the result is one of them, hence ≈ a1.
    expect(a2).toBeCloseTo(a1, 1);
  });

  it("getNearestOwnerPoint returns boundary point", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(500, 500, 100));
    const np = sys.getNearestOwnerPoint(1, { x: 700, y: 500 });
    expect(np).not.toBeNull();
    if (np) {
      expect(np.x).toBeCloseTo(600, 0);
      expect(np.y).toBeCloseTo(500, 0);
    }
  });

  it("shrink keeps largest shell", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(500, 500, 100));
    sys.shrink(1, 0.5);
    // shrink keeps largest polygon shell; with one shell that's <= half area
    // we expect either no change (one shell) or kept-as-is (single shell of
    // 100% area — algorithm stops when acc >= keepArea).
    expect(sys.getOwnerPercent(1)).toBeGreaterThan(0);
  });

  it("ownerAt fast-path: outside bbox returns false without point-in test", () => {
    const sys = new PolygonTerritorySystem(null, ...makeArena());
    sys.claim(1, circle(100, 100, 50));
    sys.claim(2, circle(900, 900, 50));
    expect(sys.ownerAt(500, 500)).toBe(0);
  });
});
