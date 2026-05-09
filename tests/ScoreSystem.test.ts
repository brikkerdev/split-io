import { describe, it, expect, beforeEach } from "vitest";
import { ScoreSystem } from "../src/systems/ScoreSystem";
import { SCORE } from "../src/config/score";
import { GameEvents } from "../src/events/GameEvents";

// ---------------------------------------------------------------------------
// Minimal Phaser.Scene stub — mimics Phaser EventEmitter context binding.
// ---------------------------------------------------------------------------
type Handler = (...args: unknown[]) => void;

function makeScene() {
  const listeners: Map<string, Array<{ fn: Handler; ctx: unknown }>> = new Map();

  function on(event: string, handler: Handler, context?: unknown): void {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event)!.push({ fn: handler, ctx: context });
  }

  function off(event: string, handler: Handler, context?: unknown): void {
    const arr = listeners.get(event);
    if (!arr) return;
    listeners.set(
      event,
      arr.filter((e) => !(e.fn === handler && e.ctx === context)),
    );
  }

  const emitted: Array<[string, ...unknown[]]> = [];

  function emit(event: string, ...args: unknown[]): void {
    emitted.push([event, ...args]);
    listeners.get(event)?.forEach((e) => e.fn.call(e.ctx ?? null, ...args));
  }

  return { events: { on, off, emit }, emitted };
}

// ---------------------------------------------------------------------------

describe("ScoreSystem — GDD §2.1 formula", () => {
  let scene: ReturnType<typeof makeScene>;
  let sys: ScoreSystem;

  beforeEach(() => {
    scene = makeScene();
    sys = new ScoreSystem(scene as never);
    sys.setHeroId(0);
  });

  it("starts at zero", () => {
    expect(sys.getCurrentScore()).toBe(0);
  });

  it("reset clears all state", () => {
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 50 });
    sys.reset();
    expect(sys.getCurrentScore()).toBe(0);
    const bd = sys.getBreakdown();
    expect(bd.kills).toBe(0);
    expect(bd.cycleCount).toBe(0);
    expect(bd.territoryPoints).toBe(0);
  });

  // ---- territory accumulation ----

  it("territory gain accumulates in totalTerritoryCapturedPct", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 30 });
    expect(sys.getBreakdown().territoryPoints).toBe(30 * SCORE.territoryPointsPerPct);
  });

  it("territory only adds gain (no double-count on re-emit same pct)", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 40 });
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 40 });
    expect(sys.getBreakdown().territoryPoints).toBe(40 * SCORE.territoryPointsPerPct);
  });

  it("territory does not subtract when pct drops", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 60 });
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 20 });
    expect(sys.getBreakdown().territoryPoints).toBe(60 * SCORE.territoryPointsPerPct);
  });

  it("ignores territory updates from non-player owners", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 1, percent: 99 });
    expect(sys.getCurrentScore()).toBe(0);
  });

  // ---- cross-cycle territory accumulation ----

  it("accumulates territory across cycles", () => {
    // Cycle 1: capture 100%.
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 100 });
    // CycleStart resets lastCyclePct.
    scene.events.emit(GameEvents.CycleStart, { cycle: 1 });
    // Cycle 2: capture 50%.
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 50 });
    const bd = sys.getBreakdown();
    expect(bd.territoryPoints).toBe(150 * SCORE.territoryPointsPerPct);
  });

  // ---- cycle points ----

  it("adds cyclePoints per cycle via CycleStart", () => {
    scene.events.emit(GameEvents.CycleStart, { cycle: 2 });
    const bd = sys.getBreakdown();
    expect(bd.cycleCount).toBe(2);
    expect(bd.cyclePoints).toBe(2 * SCORE.cyclePoints);
  });

  it("setCycleCount updates cycleCount directly", () => {
    sys.setCycleCount(3);
    expect(sys.getBreakdown().cycleCount).toBe(3);
  });

  // ---- kill bonus ----

  it("adds kill bonus when hero kills (killer=0)", () => {
    scene.events.emit(GameEvents.TrailCut, { victim: 2, killer: 0 });
    expect(sys.getCurrentScore()).toBe(SCORE.killBonus);
  });

  it("ignores kills where hero is victim or bystander", () => {
    scene.events.emit(GameEvents.TrailCut, { victim: 0, killer: 1 });
    scene.events.emit(GameEvents.TrailCut, { victim: 3, killer: 2 });
    expect(sys.getCurrentScore()).toBe(0);
  });

  it("accumulates multiple kills", () => {
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });
    scene.events.emit(GameEvents.TrailCut, { victim: 2, killer: 0 });
    expect(sys.getCurrentScore()).toBe(2 * SCORE.killBonus);
  });

  // ---- full formula ----

  it("total = territory + cycles + kills - penalty", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 40 });
    scene.events.emit(GameEvents.CycleStart, { cycle: 1 });
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });
    sys.addPenalty(500);

    const bd = sys.getBreakdown();
    const expected =
      40 * SCORE.territoryPointsPerPct + 1 * SCORE.cyclePoints + SCORE.killBonus - 500;
    expect(bd.total).toBe(Math.max(0, expected));
  });

  // ---- penalty ----

  it("addPenalty reduces total", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 50 });
    sys.addPenalty(SCORE.deathPenalty);
    const bd = sys.getBreakdown();
    expect(bd.penalty).toBe(SCORE.deathPenalty);
    expect(bd.total).toBe(Math.max(0, 50 * SCORE.territoryPointsPerPct - SCORE.deathPenalty));
  });

  it("total never goes below zero", () => {
    sys.addPenalty(999999);
    expect(sys.getBreakdown().total).toBe(0);
  });

  // ---- finalize ----

  it("finalize returns RoundBreakdown with secondsBonus=0", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 30 });
    const rd = sys.finalize(120, 30, 2, true);
    expect(rd.rank).toBe(2);
    expect(rd.bestNew).toBe(true);
    expect(rd.secondsBonus).toBe(0);
    expect(rd.territoryPoints).toBe(30 * SCORE.territoryPointsPerPct);
  });

  // ---- round:end event ----

  it("round:end emits ScoreUpdate with current total", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 20 });
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });

    const scoreUpdates = scene.emitted.filter(([ev]) => ev === GameEvents.ScoreUpdate);
    const before = scoreUpdates.length;

    scene.events.emit(GameEvents.RoundEnd, { remainingMs: 30_000 });

    const after = scene.emitted.filter(([ev]) => ev === GameEvents.ScoreUpdate);
    expect(after.length).toBeGreaterThan(before);

    const expected = 20 * SCORE.territoryPointsPerPct + SCORE.killBonus;
    expect(sys.getCurrentScore()).toBe(expected);
  });
});
