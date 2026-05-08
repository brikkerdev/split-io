import { describe, it, expect, beforeEach, vi } from "vitest";
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

  const emitMock = vi.fn();

  function emit(event: string, ...args: unknown[]): void {
    emitMock(event, ...args);
    listeners.get(event)?.forEach((e) => e.fn.call(e.ctx ?? null, ...args));
  }

  return { events: { on, off, emit, emitMock } };
}

// ---------------------------------------------------------------------------

describe("ScoreSystem", () => {
  let scene: ReturnType<typeof makeScene>;
  let sys: ScoreSystem;

  beforeEach(() => {
    scene = makeScene();
    sys = new ScoreSystem(scene as never);
    // Tests use owner=0/killer=0 as the hero id by convention.
    // Production wiring uses Hero.id (1+); ScoreSystem treats `setHeroId` as authoritative.
    (sys as unknown as { setHeroId(id: number): void }).setHeroId(0);
  });

  it("starts at zero", () => {
    expect(sys.getCurrentScore()).toBe(0);
  });

  it("reset clears state", () => {
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });
    sys.reset();
    expect(sys.getCurrentScore()).toBe(0);
    expect(sys.getBreakdown(0).kills).toBe(0);
  });

  // ---- territory formula ----

  it("territory update emits live score via ScoreUpdate", () => {
    const emitted: number[] = [];
    scene.events.on(GameEvents.ScoreUpdate, (v: unknown) => emitted.push(v as number));

    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 50 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe(50 * SCORE.territoryWeight);
  });

  it("ignores territory updates from non-player owners", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 1, percent: 99 });
    expect(sys.getCurrentScore()).toBe(0);
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

  // ---- getBreakdown ----

  it("breakdown reflects territory + speed + kills", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 40 });
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });

    const bd = sys.getBreakdown(60);
    expect(bd.territoryPct).toBe(40);
    expect(bd.territoryPoints).toBe(40 * SCORE.territoryWeight);
    expect(bd.speedBonus).toBe(60 * SCORE.secondWeight);
    expect(bd.kills).toBe(1);
    expect(bd.killPoints).toBe(SCORE.killBonus);
    expect(bd.penalty).toBe(0);
    expect(bd.total).toBe(
      40 * SCORE.territoryWeight + 60 * SCORE.secondWeight + SCORE.killBonus,
    );
  });

  // ---- finalize ----

  it("finalize returns RoundBreakdown with rank + bestNew", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 30 });
    const rd = sys.finalize(120, 30, 2, true);
    expect(rd.rank).toBe(2);
    expect(rd.bestNew).toBe(true);
    expect(rd.total).toBe(30 * SCORE.territoryWeight + 120 * SCORE.secondWeight);
    expect(rd.secondsBonus).toBe(120 * SCORE.secondWeight);
  });

  // ---- penalty ----

  it("addPenalty reduces total", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 10 });
    sys.addPenalty(200);
    const bd = sys.getBreakdown(0);
    expect(bd.penalty).toBe(200);
    expect(bd.total).toBe(10 * SCORE.territoryWeight - 200);
  });

  it("total never goes below zero", () => {
    sys.addPenalty(999999);
    expect(sys.getBreakdown(0).total).toBe(0);
  });

  // ---- round:end event ----

  it("round:end triggers ScoreUpdate with final score", () => {
    scene.events.emit(GameEvents.TerritoryUpdate, { owner: 0, percent: 20 });
    scene.events.emit(GameEvents.TrailCut, { victim: 1, killer: 0 });

    const emitted: number[] = [];
    scene.events.on(GameEvents.ScoreUpdate, (v: unknown) => emitted.push(v as number));

    scene.events.emit(GameEvents.RoundEnd, { remainingMs: 30_000 });

    const expected =
      20 * SCORE.territoryWeight +
      30 * SCORE.secondWeight +
      SCORE.killBonus;
    expect(emitted[emitted.length - 1]).toBe(expected);
    expect(sys.getCurrentScore()).toBe(expected);
  });
});
