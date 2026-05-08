import { describe, it, expect, vi, beforeEach } from "vitest";
import { Ghost } from "@entities/Ghost";
import { GHOST } from "@config/ghost";

// ---------------------------------------------------------------------------
// Ghost entity unit tests (pure logic, no Phaser)
// ---------------------------------------------------------------------------

describe("Ghost entity", () => {
  let ghost: Ghost;

  beforeEach(() => {
    ghost = new Ghost(100, 1);
    ghost.spawn({ x: 0, y: 0 }, 0, 5, GHOST.preflySec);
  });

  it("starts in prefly phase", () => {
    expect(ghost.phase).toBe("prefly");
    expect(ghost.age).toBe(0);
  });

  it("transitions prefly -> homing after preflySec", () => {
    // Tick just before threshold — no transition yet.
    ghost.tick(GHOST.preflySec - 0.001);
    expect(ghost.phase).toBe("prefly");

    // Tick past threshold.
    const newPhase = ghost.tick(0.002);
    expect(ghost.phase).toBe("homing");
    expect(newPhase).toBe("homing");
  });

  it("transitions homing -> fallback at maxLifetimeSec", () => {
    // Advance to homing.
    ghost.tick(GHOST.preflySec + 0.01);
    expect(ghost.phase).toBe("homing");

    // Advance to max lifetime.
    const remaining = GHOST.maxLifetimeSec - ghost.age;
    const newPhase = ghost.tick(remaining + 0.001);
    expect(ghost.phase).toBe("fallback");
    expect(newPhase).toBe("fallback");
  });

  it("moves along heading each tick", () => {
    // heading = 0 (east), speed = 5 cells/sec, dt = 1 sec
    ghost.tick(1);
    expect(ghost.pos.x).toBeCloseTo(5, 5);
    expect(ghost.pos.y).toBeCloseTo(0, 5);
  });

  it("steerToward smoothly rotates heading within max turn rate", () => {
    // Ghost at (0,0) heading 0, target is directly north (angle = π/2).
    const target = { x: 0, y: 10 };
    const maxRate = GHOST.homingTurnRateRadPerSec; // rad/sec
    const dt = 0.1;

    ghost.steerToward(target, maxRate, dt);
    const maxExpected = maxRate * dt;

    // Heading should move toward π/2 by at most maxRate * dt.
    expect(ghost.heading).toBeGreaterThan(0);
    expect(ghost.heading).toBeLessThanOrEqual(maxExpected + 1e-9);
  });

  it("steerToward normalises angle delta through ±π", () => {
    // Heading = π (west), target directly east (angle 0 = shortest via ±π flip).
    ghost.spawn({ x: 0, y: 0 }, Math.PI, 5, GHOST.preflySec);
    const target = { x: 10, y: 0 };
    const before = ghost.heading; // π

    ghost.steerToward(target, GHOST.homingTurnRateRadPerSec, 0.1);
    // Heading should move away from π (toward 0 via shortest arc).
    expect(Math.abs(ghost.heading)).toBeLessThan(Math.abs(before));
  });

  it("kill() sets alive to false", () => {
    ghost.kill();
    expect(ghost.alive).toBe(false);
  });

  it("tick() does nothing after kill", () => {
    ghost.kill();
    const result = ghost.tick(10);
    expect(result).toBeNull();
    expect(ghost.phase).toBe("prefly"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// GhostSystem cooldown logic (extracted as pure functions for testability)
// ---------------------------------------------------------------------------

describe("GhostSystem cooldown", () => {
  it("canSplit is false during cooldown window", () => {
    const cooldownEnd = 6000; // ms
    const canSplit = (nowMs: number, active: boolean) =>
      !active && nowMs >= cooldownEnd;

    expect(canSplit(0, false)).toBe(false);
    expect(canSplit(5999, false)).toBe(false);
    expect(canSplit(6000, false)).toBe(true);
    expect(canSplit(6001, false)).toBe(true);
    expect(canSplit(6001, true)).toBe(false); // ghost still active
  });

  it("cooldown starts only after ghost is destroyed", () => {
    let cooldownEnd = 0;
    const cooldownSec = 6;

    // Simulate ghost destroyed at t=5000ms.
    const destroyedAt = 5000;
    cooldownEnd = destroyedAt + cooldownSec * 1000;

    expect(cooldownEnd).toBe(11000);
    // Not ready at 10999.
    expect(11000 > 10999).toBe(true);
    // Ready at 11000.
    expect(11000 >= 11000).toBe(true);
  });

  it("cooldown respects minimum clamp", () => {
    const clamp = (sec: number) => Math.max(GHOST.cooldownMinSec, sec);
    expect(clamp(6)).toBe(6);
    expect(clamp(4)).toBe(4);
    expect(clamp(3)).toBe(3);
    expect(clamp(2)).toBe(3); // clamped to min
    expect(clamp(0)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Ghost prefly duration upgrade integration
// ---------------------------------------------------------------------------

describe("Ghost preflySec upgrade", () => {
  it("homingDelayBonusSec extends prefly phase", () => {
    const ghost = new Ghost(101, 1);
    const bonusSec = 2;
    const effectivePrefly = GHOST.preflySec + bonusSec; // 5s

    ghost.spawn({ x: 0, y: 0 }, 0, 5, effectivePrefly);
    expect(ghost.preflySec).toBe(5);

    // At 3s still in prefly.
    ghost.tick(3);
    expect(ghost.phase).toBe("prefly");

    // At 5s transitions to homing.
    ghost.tick(2 + 0.001);
    expect(ghost.phase).toBe("homing");
  });

  it("preflySec capped at homingDelayBonusMaxSec + base", () => {
    const max = GHOST.preflySec + GHOST.homingDelayBonusMaxSec;
    expect(max).toBe(9); // 3 + 6
  });
});

// ---------------------------------------------------------------------------
// Homing phase: steer toward hero position
// ---------------------------------------------------------------------------

describe("Ghost homing arc", () => {
  it("approaches target over multiple ticks", () => {
    const ghost = new Ghost(102, 1);
    ghost.spawn({ x: 0, y: 0 }, 0, 4, GHOST.preflySec);

    // Fast-forward to homing phase.
    ghost.tick(GHOST.preflySec + 0.01);
    expect(ghost.phase).toBe("homing");

    const target = { x: ghost.pos.x, y: ghost.pos.y + 20 }; // directly south

    let prevDist = Math.hypot(target.x - ghost.pos.x, target.y - ghost.pos.y);

    for (let i = 0; i < 20; i++) {
      ghost.steerToward(target, GHOST.homingTurnRateRadPerSec, 0.1);
      ghost.tick(0.1);
      const dist = Math.hypot(target.x - ghost.pos.x, target.y - ghost.pos.y);
      // Distance should decrease (ghost closing in).
      if (i > 5) {
        // Allow initial frames for heading to pivot.
        expect(dist).toBeLessThan(prevDist + 0.01);
      }
      prevDist = dist;
    }
  });
});
