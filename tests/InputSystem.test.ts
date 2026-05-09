import { describe, it, expect } from "vitest";
import { INPUT } from "../src/config/input";

// Pure logic extracted from InputSystem for unit testing (no Phaser dependency).

function normaliseAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function shortestDelta(current: number, target: number): number {
  return normaliseAngle(target - current);
}

function lerpAngle(from: number, to: number, t: number): number {
  return from + normaliseAngle(to - from) * t;
}

/** One frame of smoothHeading logic. */
function smoothHeading(current: number, target: number, dtMs: number): number {
  const dtSec = dtMs / 1000;
  const delta = shortestDelta(current, target);
  const maxStep = INPUT.turnRateRadPerSec * dtSec;
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  return normaliseAngle(current + step);
}

/** Apply hysteresis + rawSmoothing, returns new targetHeading or old if below threshold. */
function applyRawInput(
  targetHeading: number,
  raw: number,
): number {
  const delta = Math.abs(normaliseAngle(raw - targetHeading));
  if (delta < INPUT.headingHysteresisRad) return targetHeading;
  return normaliseAngle(lerpAngle(targetHeading, raw, INPUT.rawSmoothingFactor));
}

describe("INPUT constants", () => {
  it("turnRateRadPerSec is 6", () => {
    expect(INPUT.turnRateRadPerSec).toBe(6);
  });

  it("headingHysteresisRad is 0.05", () => {
    expect(INPUT.headingHysteresisRad).toBe(0.05);
  });

  it("rawSmoothingFactor is 0.3", () => {
    expect(INPUT.rawSmoothingFactor).toBe(0.3);
  });

  it("deadzonePixels is 70", () => {
    expect(INPUT.deadzonePixels).toBe(70);
  });

  it("stickRadiusPx is 64", () => {
    expect(INPUT.stickRadiusPx).toBe(64);
  });

  it("tapMaxMs is 200", () => {
    expect(INPUT.tapMaxMs).toBe(200);
  });

  it("tapMaxDragPx is 12", () => {
    expect(INPUT.tapMaxDragPx).toBe(12);
  });
});

describe("normaliseAngle", () => {
  it("keeps 0 at 0", () => {
    expect(normaliseAngle(0)).toBeCloseTo(0);
  });

  it("wraps values above PI", () => {
    expect(normaliseAngle(Math.PI + 0.1)).toBeCloseTo(-(Math.PI - 0.1));
  });

  it("wraps values below -PI", () => {
    expect(normaliseAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1);
  });
});

describe("hysteresis", () => {
  it("ignores raw input below threshold", () => {
    const target = 1.0;
    const raw = target + INPUT.headingHysteresisRad * 0.5; // tiny delta
    const result = applyRawInput(target, raw);
    expect(result).toBe(target);
  });

  it("accepts raw input above threshold", () => {
    const target = 1.0;
    const raw = target + INPUT.headingHysteresisRad * 2;
    const result = applyRawInput(target, raw);
    expect(result).not.toBe(target);
    // Should move toward raw by smoothingFactor
    expect(result).toBeCloseTo(lerpAngle(target, raw, INPUT.rawSmoothingFactor), 5);
  });
});

describe("smoothHeading (turn rate)", () => {
  it("does not exceed max step per frame", () => {
    const dtMs = 16;
    const current = 0;
    const target = Math.PI; // 180° away
    const next = smoothHeading(current, target, dtMs);
    const maxStep = INPUT.turnRateRadPerSec * (dtMs / 1000);
    expect(Math.abs(next - current)).toBeCloseTo(maxStep, 5);
  });

  it("converges to target over multiple frames", () => {
    let heading = 0;
    const target = Math.PI / 4; // 45°
    for (let i = 0; i < 300; i++) {
      heading = smoothHeading(heading, target, 16);
    }
    expect(heading).toBeCloseTo(target, 3);
  });

  it("takes the short arc when wrapping", () => {
    const current = Math.PI - 0.1;
    const target = -(Math.PI - 0.1); // just across the ±PI boundary
    const next = smoothHeading(current, target, 16);
    // Should move CCW (short arc is -0.2 rad), not CW (long arc)
    expect(next).toBeGreaterThan(current);
  });
});

describe("rawSmoothing", () => {
  it("does not jump instantly to new heading", () => {
    const target = 0;
    const raw = Math.PI / 2; // 90°
    const result = applyRawInput(target, raw);
    // With factor 0.3, result should be 30% of the way
    expect(result).toBeCloseTo(lerpAngle(target, raw, INPUT.rawSmoothingFactor), 5);
    expect(result).toBeLessThan(raw);
  });
});
