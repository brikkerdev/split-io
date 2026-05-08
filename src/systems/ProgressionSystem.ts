import type Phaser from "phaser";
import { BALANCE } from "@config/balance";
import { UPGRADES, type UpgradeId } from "@config/upgrades";
import { GameEvents } from "@events/GameEvents";

type UpgradeStacks = Record<UpgradeId, number>;

/** Fires upgrade:offer every upgradeThresholdPct territory. Auto-closes after upgradeAutoCloseSec. */
export class ProgressionSystem {
  private lastOfferedAtPct = 0;
  private stacks: UpgradeStacks = { speed: 0, homingDelay: 0, splitCooldown: 0, shield: 0 };
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(GameEvents.UpgradeApplied, this.handleApplied, this);
  }

  // ---- public API ----

  onTerritoryPct(pct: number): void {
    const threshold = BALANCE.upgradeThresholdPct;
    const bucket = Math.floor(pct / threshold) * threshold;
    if (bucket > 0 && bucket > this.lastOfferedAtPct) {
      this.lastOfferedAtPct = bucket;
      this.offer();
    }
  }

  applyUpgrade(id: UpgradeId): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    if (this.stacks[id] >= def.maxStacks) return;
    this.stacks[id] += 1;
    this.cancelAutoClose();
    this.scene.events.emit(GameEvents.UpgradeApplied, { id });
  }

  getActiveUpgrades(): Readonly<UpgradeStacks> {
    return this.stacks;
  }

  reset(): void {
    this.lastOfferedAtPct = 0;
    this.stacks = { speed: 0, homingDelay: 0, splitCooldown: 0, shield: 0 };
    this.cancelAutoClose();
  }

  destroy(): void {
    this.scene.events.off(GameEvents.UpgradeApplied, this.handleApplied, this);
    this.cancelAutoClose();
  }

  // ---- internal ----

  private offer(): void {
    const choices = this.pickChoices(BALANCE.upgradeChoiceCount);
    this.scene.events.emit(GameEvents.UpgradeOffer, { choices });
    this.scheduleAutoClose();
  }

  private pickChoices(count: number): UpgradeId[] {
    const eligible = UPGRADES.filter((u) => this.stacks[u.id] < u.maxStacks).map((u) => u.id);
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

  private scheduleAutoClose(): void {
    this.cancelAutoClose();
    this.autoCloseTimer = setTimeout(() => {
      this.autoCloseTimer = null;
      this.scene.events.emit(GameEvents.UpgradeOffer, { choices: [] });
    }, BALANCE.upgradeAutoCloseSec * 1000);
  }

  private cancelAutoClose(): void {
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  /** Handles external UpgradeApplied emissions (e.g. from UI scene). */
  private readonly handleApplied = (_payload: { id: UpgradeId }): void => {
    this.cancelAutoClose();
  };
}
