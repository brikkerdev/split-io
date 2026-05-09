import { describe, expect, it } from "vitest";
import type { MultiPolygon, Polygon, Ring } from "@gametypes/geometry";
import {
  bboxContains,
  circlePolygon,
  difference,
  distanceToSegmentSq,
  intersection,
  multiPolygonArea,
  multiPolygonBbox,
  nearestPointOnRing,
  pointInMultiPolygon,
  pointInPolygon,
  pointInRing,
  polygonArea,
  polylineToRing,
  segmentsIntersect,
  union,
} from "./polygon";

describe("polygon: construction", () => {
  it("circlePolygon returns a closed N-segment ring", () => {
    const c = circlePolygon(0, 0, 10, 24);
    expect(c.length).toBe(1);
    const ring = c[0] as Ring;
    expect(ring.length).toBe(25);
    expect(ring[0]).toEqual(ring[24]);
  });

  it("circlePolygon area approximates pi*r^2 for high segment count", () => {
    const c = circlePolygon(0, 0, 100, 96);
    const area = polygonArea(c);
    // 96 segments slightly under-approximates the circle; tolerate ~50 px².
    expect(area).toBeCloseTo(Math.PI * 10000, -2);
  });

  it("polylineToRing converts Vec2 to Pair", () => {
    const ring = polylineToRing([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(ring).toEqual([
      [0, 0],
      [10, 5],
    ]);
  });
});

describe("polygon: area", () => {
  it("polygonArea: 10x10 square", () => {
    const sq: Polygon = [[
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]];
    expect(polygonArea(sq)).toBeCloseTo(100);
  });

  it("polygonArea subtracts hole", () => {
    const withHole: Polygon = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [3, 3],
        [3, 7],
        [7, 7],
        [7, 3],
        [3, 3],
      ],
    ];
    expect(polygonArea(withHole)).toBeCloseTo(100 - 16);
  });

  it("multiPolygonArea sums components", () => {
    const mp: MultiPolygon = [
      [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
      [[[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]],
    ];
    expect(multiPolygonArea(mp)).toBeCloseTo(50);
  });
});

describe("polygon: boolean ops", () => {
  it("union: two overlapping squares = 175", () => {
    const a: MultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
    const b: MultiPolygon = [[[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]]];
    expect(multiPolygonArea(union(a, b))).toBeCloseTo(175);
  });

  it("difference: square minus overlap = 75", () => {
    const a: MultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
    const b: MultiPolygon = [[[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]]];
    expect(multiPolygonArea(difference(a, b))).toBeCloseTo(75);
  });

  it("intersection: overlap = 25", () => {
    const a: MultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
    const b: MultiPolygon = [[[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]]];
    expect(multiPolygonArea(intersection(a, b))).toBeCloseTo(25);
  });

  it("union with empty side returns the other", () => {
    const a: MultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
    expect(multiPolygonArea(union(a, []))).toBeCloseTo(100);
    expect(multiPolygonArea(union([], a))).toBeCloseTo(100);
  });

  it("difference of fully-contained subject = 0", () => {
    const small: MultiPolygon = [[[[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]]];
    const big: MultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
    expect(multiPolygonArea(difference(small, big))).toBeCloseTo(0);
  });
});

describe("polygon: bbox", () => {
  it("multiPolygonBbox covers all outer points", () => {
    const mp: MultiPolygon = [
      [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
      [[[10, 10], [15, 10], [15, 20], [10, 20], [10, 10]]],
    ];
    expect(multiPolygonBbox(mp)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 15,
      maxY: 20,
    });
  });

  it("bboxContains handles inside / outside / boundary", () => {
    const b = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(bboxContains(b, 5, 5)).toBe(true);
    expect(bboxContains(b, 0, 0)).toBe(true);
    expect(bboxContains(b, 10, 10)).toBe(true);
    expect(bboxContains(b, -1, 5)).toBe(false);
    expect(bboxContains(b, 5, 11)).toBe(false);
  });
});

describe("polygon: point-in tests", () => {
  it("pointInRing: square 0..10", () => {
    const ring: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(pointInRing([5, 5], ring)).toBe(true);
    expect(pointInRing([15, 5], ring)).toBe(false);
    expect(pointInRing([-1, 5], ring)).toBe(false);
  });

  it("pointInPolygon: respects holes", () => {
    const p: Polygon = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
    ];
    expect(pointInPolygon([5, 5], p)).toBe(false);
    expect(pointInPolygon([1, 1], p)).toBe(true);
    expect(pointInPolygon([100, 100], p)).toBe(false);
  });

  it("pointInMultiPolygon: any of components", () => {
    const mp: MultiPolygon = [
      [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
      [[[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]],
    ];
    expect(pointInMultiPolygon([2, 2], mp)).toBe(true);
    expect(pointInMultiPolygon([12, 12], mp)).toBe(true);
    expect(pointInMultiPolygon([7, 7], mp)).toBe(false);
  });
});

describe("polygon: distance / nearest", () => {
  it("distanceToSegmentSq: perpendicular foot", () => {
    expect(distanceToSegmentSq([5, 5], [0, 0], [10, 0])).toBeCloseTo(25);
  });

  it("distanceToSegmentSq: clamped to endpoint", () => {
    expect(distanceToSegmentSq([20, 0], [0, 0], [10, 0])).toBeCloseTo(100);
  });

  it("nearestPointOnRing: closest edge of square", () => {
    const ring: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const { point } = nearestPointOnRing([15, 5], ring);
    expect(point[0]).toBeCloseTo(10);
    expect(point[1]).toBeCloseTo(5);
  });
});

describe("polygon: segment intersection", () => {
  it("crossing segments", () => {
    expect(
      segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0]),
    ).toBe(true);
  });

  it("non-crossing parallel", () => {
    expect(
      segmentsIntersect([0, 0], [10, 0], [0, 5], [10, 5]),
    ).toBe(false);
  });

  it("non-crossing far apart", () => {
    expect(
      segmentsIntersect([0, 0], [5, 5], [10, 10], [15, 15]),
    ).toBe(false);
  });
});
