import type Phaser from "phaser";
import { UPGRADES, UPGRADE_MAGNITUDES, type UpgradeId } from "@config/upgrades";
import { BALANCE } from "@config/balance";
import { GameEvents } from "@events/GameEvents";
import type { Hero } from "@entities/Hero";

type UpgradeStacks = Record<UpgradeId, number>;

const CHOICE_COUNT = 2;
const THRESHOLD_STEP = 25;
const FULL_CYCLE_PCT = 100;

export class ProgressionSystem {
  private stacks: UpgradeStacks = this.makeEmptyStacks();
  private cycleCount = 0;
  /** Next territory % at which we offer an upgrade. 25 → 50 → 75 → 100, then 25 again. */
  private nextThresholdPct = THRESHOLD_STEP;
  /** True once we have offered for the current threshold (reset on apply). */
  private offeredForThreshold = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hero: Hero,
    private readonly onUpgradeApplied: (fullCycle: boolean) => void,
  ) {}

  // ── Public API ───────────────────────────────────────────

  /** Called every frame with current hero territory %. Triggers offer at 25/50/75/100. */
  onTerritoryPct(pct: number): void {
    if (this.offeredForThreshold) return;
    if (pct < this.nextThresholdPct) return;

    this.offeredForThreshold = true;

    if (this.isPoolExhausted()) {
      if (this.nextThresholdPct >= FULL_CYCLE_PCT) {
        this.scene.events.emit(GameEvents.Victory);
        return;
      }
      // Pool empty at sub-threshold: skip silently and advance to next.
      this.advanceThreshold(false);
      return;
    }

    const choices = this.pickChoices(CHOICE_COUNT);
    this.scene.events.emit(GameEvents.UpgradeOffer, { choices });
  }

  applyUpgrade(id: UpgradeId): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    if (this.stacks[id] >= def.maxStacks) return;

    this.stacks[id] += 1;
    this.applyEffect(id);

    const fullCycle = this.nextThresholdPct >= FULL_CYCLE_PCT;
    this.advanceThreshold(fullCycle);

    this.scene.events.emit(GameEvents.UpgradeApplied, { id });

    if (fullCycle) {
      this.cycleCount += 1;
      this.scene.events.emit(GameEvents.CycleStart, { cycle: this.cycleCount });
    }

    this.onUpgradeApplied(fullCycle);
  }

  getEligibleUpgrades(): UpgradeId[] {
    return UPGRADES.filter((u) => this.stacks[u.id] < u.maxStacks).map((u) => u.id);
  }

  isPoolExhausted(): boolean {
    return this.getEligibleUpgrades().length === 0;
  }

  getCycleCount(): number {
    return this.cycleCount;
  }

  getActiveStacks(): Readonly<UpgradeStacks> {
    return this.stacks;
  }

  /** Full reset — use when starting a brand-new run (not between cycles). */
  reset(): void {
    this.stacks = this.makeEmptyStacks();
    this.cycleCount = 0;
    this.nextThresholdPct = THRESHOLD_STEP;
    this.offeredForThreshold = false;
    this.hero.ghostSpeedBonusMult = 0;
    this.hero.ghostLifetimeBonusSec = 0;
    this.hero.ghostCooldownReductionSec = 0;
    this.hero.passiveSpeedBonusMult = 0;
  }

  /** Marks that we have entered a new cycle (territory cleared). No stack wipe. */
  resetCycleFlag(): void {
    this.nextThresholdPct = THRESHOLD_STEP;
    this.offeredForThreshold = false;
  }

  destroy(): void {
    // nothing to unsubscribe (we don't listen to events)
  }

  // ── Private ──────────────────────────────────────────────

  private advanceThreshold(fullCycle: boolean): void {
    this.nextThresholdPct = fullCycle
      ? THRESHOLD_STEP
      : this.nextThresholdPct + THRESHOLD_STEP;
    this.offeredForThreshold = false;
  }

  private applyEffect(id: UpgradeId): void {
    const m = UPGRADE_MAGNITUDES;
    switch (id) {
      case "ghostSpeed":
        this.hero.ghostSpeedBonusMult += m.ghostSpeedMultPerStack;
        break;
      case "ghostLifetime":
        this.hero.ghostLifetimeBonusSec += m.ghostLifetimeSecPerStack;
        break;
      case "ghostCooldown":
        this.hero.ghostCooldownReductionSec += m.ghostCooldownReductionPerStack;
        break;
      case "passiveSpeed": {
        const cap = BALANCE.heroBaseSpeedCellsPerSec * m.passiveSpeedCapMult;
        const currentMult = 1 + this.hero.passiveSpeedBonusMult + m.passiveSpeedMultPerStack;
        const effectiveSpeed = BALANCE.heroBaseSpeedCellsPerSec * currentMult;
        if (effectiveSpeed > cap) {
          this.hero.passiveSpeedBonusMult = m.passiveSpeedCapMult - 1;
        } else {
          this.hero.passiveSpeedBonusMult += m.passiveSpeedMultPerStack;
        }
        break;
      }
    }
  }

  private pickChoices(count: number): UpgradeId[] {
    const eligible = this.getEligibleUpgrades();
    if (eligible.length <= count) return eligible.slice();

    const pool = eligible.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      const src = pool[j];
      if (tmp !== undefined && src !== undefined) {
        pool[i] = src;
        pool[j] = tmp;
      }
    }
    return pool.slice(0, count);
  }

  private makeEmptyStacks(): UpgradeStacks {
    return {
      ghostSpeed: 0,
      ghostLifetime: 0,
      ghostCooldown: 0,
      passiveSpeed: 0,
    };
  }
}
