import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProgressionSystem } from "../src/systems/ProgressionSystem";
import { UPGRADE_MAGNITUDES } from "../src/config/upgrades";
import { BALANCE } from "../src/config/balance";

vi.mock("../src/events/GameEvents", () => ({
  GameEvents: {
    UpgradeOffer: "upgrade:offer",
    UpgradeApplied: "upgrade:applied",
    CycleStart: "cycle:start",
    Victory: "victory",
  },
}));

function makeScene() {
  return { events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } };
}

function makeHero() {
  return {
    ghostSpeedBonusMult: 0,
    ghostLifetimeBonusSec: 0,
    ghostCooldownReductionSec: 0,
    passiveSpeedBonusMult: 0,
    speedCellsPerSec: BALANCE.heroBaseSpeedCellsPerSec,
  };
}

describe("UpgradeEffects", () => {
  let sys: ProgressionSystem;
  let hero: ReturnType<typeof makeHero>;

  beforeEach(() => {
    hero = makeHero();
    sys = new ProgressionSystem(makeScene() as never, hero as never, () => {});
  });

  it("ghostSpeed: each stack adds 0.25 to ghostSpeedBonusMult", () => {
    sys.applyUpgrade("ghostSpeed");
    expect(hero.ghostSpeedBonusMult).toBeCloseTo(UPGRADE_MAGNITUDES.ghostSpeedMultPerStack);
    sys.applyUpgrade("ghostSpeed");
    expect(hero.ghostSpeedBonusMult).toBeCloseTo(UPGRADE_MAGNITUDES.ghostSpeedMultPerStack * 2);
    sys.applyUpgrade("ghostSpeed");
    expect(hero.ghostSpeedBonusMult).toBeCloseTo(UPGRADE_MAGNITUDES.ghostSpeedMultPerStack * 3);
  });

  it("ghostLifetime: each stack adds 1.5s to ghostLifetimeBonusSec", () => {
    sys.applyUpgrade("ghostLifetime");
    expect(hero.ghostLifetimeBonusSec).toBeCloseTo(UPGRADE_MAGNITUDES.ghostLifetimeSecPerStack);
    sys.applyUpgrade("ghostLifetime");
    expect(hero.ghostLifetimeBonusSec).toBeCloseTo(UPGRADE_MAGNITUDES.ghostLifetimeSecPerStack * 2);
  });

  it("ghostCooldown: each stack adds 1 to ghostCooldownReductionSec", () => {
    sys.applyUpgrade("ghostCooldown");
    expect(hero.ghostCooldownReductionSec).toBe(UPGRADE_MAGNITUDES.ghostCooldownReductionPerStack);
    sys.applyUpgrade("ghostCooldown");
    expect(hero.ghostCooldownReductionSec).toBe(UPGRADE_MAGNITUDES.ghostCooldownReductionPerStack * 2);
  });

  describe("passiveSpeed", () => {
    const base = BALANCE.heroBaseSpeedCellsPerSec;
    const cap = UPGRADE_MAGNITUDES.passiveSpeedCapMult;
    const step = UPGRADE_MAGNITUDES.passiveSpeedMultPerStack;

    it("each stack adds passiveSpeedMultPerStack to passiveSpeedBonusMult", () => {
      sys.applyUpgrade("passiveSpeed");
      expect(hero.passiveSpeedBonusMult).toBeCloseTo(step);
    });

    it("effective speed does not exceed cap multiplier", () => {
      // Apply all 4 stacks
      for (let i = 0; i < 4; i++) sys.applyUpgrade("passiveSpeed");
      const effectiveSpeed = base * (1 + hero.passiveSpeedBonusMult);
      const maxSpeed = base * cap;
      expect(effectiveSpeed).toBeLessThanOrEqual(maxSpeed + 0.001);
    });

    it("hard cap prevents passiveSpeedBonusMult exceeding cap-1", () => {
      for (let i = 0; i < 4; i++) sys.applyUpgrade("passiveSpeed");
      expect(hero.passiveSpeedBonusMult).toBeLessThanOrEqual(cap - 1 + 0.001);
    });
  });
});
