import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ProgressionSystem } from "../src/systems/ProgressionSystem";
import { UPGRADES, UPGRADE_MAGNITUDES, type UpgradeId } from "../src/config/upgrades";
import { GameEvents } from "../src/events/GameEvents";

// ---------------------------------------------------------------------------
// Minimal scene stub.
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

function makeHero() {
  return {
    ghostSpeedBonusMult: 0,
    ghostLifetimeBonusSec: 0,
    ghostCooldownReductionSec: 0,
    passiveSpeedBonusMult: 0,
    speedCellsPerSec: 7,
  };
}

// ---------------------------------------------------------------------------

describe("ProgressionSystem", () => {
  let scene: ReturnType<typeof makeScene>;
  let hero: ReturnType<typeof makeHero>;
  let sys: ProgressionSystem;
  const noop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    scene = makeScene();
    hero = makeHero();
    sys = new ProgressionSystem(scene as never, hero as never, noop);
  });

  afterEach(() => {
    vi.useRealTimers();
    sys.destroy();
  });

  function offerCalls() {
    return scene.events.emitMock.mock.calls.filter((c) => c[0] === GameEvents.UpgradeOffer);
  }

  // ── Trigger every 25% ──────────────────────────────────────

  it("does not offer below the next threshold", () => {
    for (const pct of [0, 10, 20, 24]) {
      sys.onTerritoryPct(pct);
    }
    expect(offerCalls()).toHaveLength(0);
  });

  it("offers at 25%", () => {
    sys.onTerritoryPct(25);
    expect(offerCalls()).toHaveLength(1);
  });

  it("does not re-offer for the same threshold", () => {
    sys.onTerritoryPct(25);
    sys.onTerritoryPct(30);
    expect(offerCalls()).toHaveLength(1);
  });

  it("offers again after applyUpgrade at next threshold", () => {
    sys.onTerritoryPct(25);
    sys.applyUpgrade("ghostSpeed");
    sys.onTerritoryPct(50);
    expect(offerCalls()).toHaveLength(2);
  });

  it("fires four offers across one full cycle (25/50/75/100)", () => {
    sys.onTerritoryPct(25); sys.applyUpgrade("ghostSpeed");
    sys.onTerritoryPct(50); sys.applyUpgrade("ghostLifetime");
    sys.onTerritoryPct(75); sys.applyUpgrade("ghostCooldown");
    sys.onTerritoryPct(100); sys.applyUpgrade("passiveSpeed");
    expect(offerCalls()).toHaveLength(4);
  });

  // ── Pool / choices ────────────────────────────────────────

  it("offer payload contains array of UpgradeIds (max 2)", () => {
    sys.onTerritoryPct(25);
    const call = offerCalls()[0];
    const payload = call?.[1] as { choices: UpgradeId[] };
    expect(Array.isArray(payload.choices)).toBe(true);
    expect(payload.choices.length).toBeLessThanOrEqual(2);
    payload.choices.forEach((id) => {
      expect(UPGRADES.map((u) => u.id)).toContain(id);
    });
  });

  // ── applyUpgrade ──────────────────────────────────────────

  it("applyUpgrade increments stack up to maxStacks", () => {
    const def = UPGRADES.find((u) => u.id === "ghostSpeed")!;
    for (let i = 0; i < def.maxStacks + 2; i++) {
      sys.applyUpgrade("ghostSpeed");
    }
    expect(sys.getActiveStacks().ghostSpeed).toBe(def.maxStacks);
  });

  it("applyUpgrade applies ghost speed effect to hero", () => {
    sys.applyUpgrade("ghostSpeed");
    expect(hero.ghostSpeedBonusMult).toBeCloseTo(0.25);
    sys.applyUpgrade("ghostSpeed");
    expect(hero.ghostSpeedBonusMult).toBeCloseTo(0.5);
  });

  it("applyUpgrade applies ghostCooldown reduction to hero", () => {
    sys.applyUpgrade("ghostCooldown");
    expect(hero.ghostCooldownReductionSec).toBe(1);
  });

  it("applyUpgrade applies passiveSpeed to hero", () => {
    sys.applyUpgrade("passiveSpeed");
    expect(hero.passiveSpeedBonusMult).toBeCloseTo(UPGRADE_MAGNITUDES.passiveSpeedMultPerStack);
  });

  // ── isPoolExhausted ───────────────────────────────────────

  it("isPoolExhausted false initially", () => {
    expect(sys.isPoolExhausted()).toBe(false);
  });

  it("isPoolExhausted true when all upgrades maxed", () => {
    for (const def of UPGRADES) {
      for (let i = 0; i < def.maxStacks; i++) {
        sys.applyUpgrade(def.id);
      }
    }
    expect(sys.isPoolExhausted()).toBe(true);
  });

  // ── getCycleCount ─────────────────────────────────────────

  it("getCycleCount increments only at the 100% threshold", () => {
    expect(sys.getCycleCount()).toBe(0);
    // 25%, 50%, 75% sub-thresholds — no cycle increment.
    sys.onTerritoryPct(25); sys.applyUpgrade("ghostSpeed");
    expect(sys.getCycleCount()).toBe(0);
    sys.onTerritoryPct(50); sys.applyUpgrade("ghostLifetime");
    expect(sys.getCycleCount()).toBe(0);
    sys.onTerritoryPct(75); sys.applyUpgrade("ghostCooldown");
    expect(sys.getCycleCount()).toBe(0);
    // 100% closes the cycle.
    sys.onTerritoryPct(100); sys.applyUpgrade("passiveSpeed");
    expect(sys.getCycleCount()).toBe(1);
  });

  // ── reset ────────────────────────────────────────────────

  it("reset clears stacks and cycle count", () => {
    sys.applyUpgrade("ghostSpeed");
    sys.reset();
    expect(sys.getActiveStacks().ghostSpeed).toBe(0);
    expect(sys.getCycleCount()).toBe(0);
  });

  it("reset allows offer to fire again at 25%", () => {
    sys.onTerritoryPct(25);
    sys.reset();
    scene.events.emitMock.mockClear();
    sys.onTerritoryPct(25);
    expect(offerCalls()).toHaveLength(1);
  });

  // ── Victory emission ──────────────────────────────────────

  it("emits Victory when pool exhausted at 100%", () => {
    for (const def of UPGRADES) {
      for (let i = 0; i < def.maxStacks; i++) {
        sys.applyUpgrade(def.id);
      }
    }
    scene.events.emitMock.mockClear();
    // Walk past sub-thresholds (silently skipped) and reach 100%.
    sys.onTerritoryPct(25);
    sys.onTerritoryPct(50);
    sys.onTerritoryPct(75);
    sys.onTerritoryPct(100);

    const victoryCalls = scene.events.emitMock.mock.calls.filter(
      (c) => c[0] === GameEvents.Victory,
    );
    expect(victoryCalls).toHaveLength(1);
  });
});
