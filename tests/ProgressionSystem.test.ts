import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ProgressionSystem } from "../src/systems/ProgressionSystem";
import { BALANCE } from "../src/config/balance";
import { UPGRADES, type UpgradeId } from "../src/config/upgrades";
import { GameEvents } from "../src/events/GameEvents";

// ---------------------------------------------------------------------------
// Minimal scene stub with Phaser-style context binding.
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

describe("ProgressionSystem", () => {
  let scene: ReturnType<typeof makeScene>;
  let sys: ProgressionSystem;

  beforeEach(() => {
    vi.useFakeTimers();
    scene = makeScene();
    sys = new ProgressionSystem(scene as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    sys.destroy();
  });

  function offerCalls() {
    return scene.events.emitMock.mock.calls.filter((c) => c[0] === GameEvents.UpgradeOffer);
  }

  function appliedCalls() {
    return scene.events.emitMock.mock.calls.filter((c) => c[0] === GameEvents.UpgradeApplied);
  }

  // ---- threshold triggers ----

  it("does not offer at 0%", () => {
    sys.onTerritoryPct(0);
    expect(offerCalls()).toHaveLength(0);
  });

  it("offers at exactly 10%", () => {
    sys.onTerritoryPct(10);
    expect(offerCalls()).toHaveLength(1);
  });

  it("offers at 20% but not for 15%", () => {
    sys.onTerritoryPct(10);
    sys.onTerritoryPct(15);
    sys.onTerritoryPct(20);
    expect(offerCalls()).toHaveLength(2);
  });

  it("offers at 10 / 20 / 30% independently", () => {
    sys.onTerritoryPct(10);
    sys.onTerritoryPct(20);
    sys.onTerritoryPct(30);
    expect(offerCalls()).toHaveLength(3);
  });

  it("does not re-offer same bucket on repeated calls", () => {
    sys.onTerritoryPct(10);
    sys.onTerritoryPct(10);
    sys.onTerritoryPct(9);
    expect(offerCalls()).toHaveLength(1);
  });

  // ---- pool / choices ----

  it("offer payload contains array of UpgradeIds", () => {
    sys.onTerritoryPct(10);
    const call = offerCalls()[0];
    const payload = call?.[1] as { choices: UpgradeId[] };
    expect(Array.isArray(payload.choices)).toBe(true);
    expect(payload.choices.length).toBeLessThanOrEqual(BALANCE.upgradeChoiceCount);
    payload.choices.forEach((id) => {
      expect(UPGRADES.map((u) => u.id)).toContain(id);
    });
  });

  it("excludes maxed upgrades from choices", () => {
    for (let i = 0; i < 3; i++) sys.applyUpgrade("homingDelay");
    for (let i = 0; i < 3; i++) sys.applyUpgrade("splitCooldown");
    for (let i = 0; i < 1; i++) sys.applyUpgrade("shield");

    scene.events.emitMock.mockClear();
    sys.onTerritoryPct(10);

    const call = offerCalls()[0];
    const payload = call?.[1] as { choices: UpgradeId[] };
    payload.choices.forEach((id) => {
      expect(id).toBe("speed");
    });
  });

  // ---- applyUpgrade ----

  it("applyUpgrade increments stack and emits UpgradeApplied", () => {
    sys.applyUpgrade("speed");
    expect(sys.getActiveUpgrades().speed).toBe(1);
    expect(appliedCalls()).toHaveLength(1);
    expect((appliedCalls()[0]?.[1] as { id: UpgradeId }).id).toBe("speed");
  });

  it("does not exceed maxStacks", () => {
    for (let i = 0; i < 10; i++) sys.applyUpgrade("shield");
    expect(sys.getActiveUpgrades().shield).toBe(1);
  });

  it("getActiveUpgrades returns all keys", () => {
    const upgrades = sys.getActiveUpgrades();
    expect(Object.keys(upgrades).sort()).toEqual(["homingDelay", "shield", "speed", "splitCooldown"]);
  });

  // ---- auto-close ----

  it("auto-close emits UpgradeOffer with empty choices after timeout", () => {
    sys.onTerritoryPct(10);
    const beforeClose = offerCalls().length;
    expect(beforeClose).toBe(1);

    vi.advanceTimersByTime(BALANCE.upgradeAutoCloseSec * 1000);

    const all = offerCalls();
    expect(all).toHaveLength(2);
    const lastPayload = all[1]?.[1] as { choices: UpgradeId[] };
    expect(lastPayload.choices).toHaveLength(0);
  });

  it("applyUpgrade cancels auto-close timer", () => {
    sys.onTerritoryPct(10);
    sys.applyUpgrade("speed");
    vi.advanceTimersByTime(BALANCE.upgradeAutoCloseSec * 1000 + 1000);

    expect(offerCalls()).toHaveLength(1);
  });

  // ---- reset ----

  it("reset clears stacks and threshold", () => {
    sys.applyUpgrade("speed");
    sys.onTerritoryPct(10);
    sys.reset();

    expect(sys.getActiveUpgrades().speed).toBe(0);

    scene.events.emitMock.mockClear();
    sys.onTerritoryPct(10);
    expect(offerCalls()).toHaveLength(1);
  });
});
