// In-round upgrade pool. Source: GDD §3.

export type UpgradeId = "speed" | "homingDelay" | "splitCooldown" | "shield";

export interface UpgradeDef {
  id: UpgradeId;
  iconKey: string;
  maxStacks: number;
  /** Human-readable label key for locale lookup. */
  labelKey: string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: "speed",         iconKey: "ic_speed",   maxStacks: 5, labelKey: "upgrade_speed" },
  { id: "homingDelay",   iconKey: "ic_homing",  maxStacks: 3, labelKey: "upgrade_homing" },
  { id: "splitCooldown", iconKey: "ic_split",   maxStacks: 3, labelKey: "upgrade_split_cd" },
  { id: "shield",        iconKey: "ic_shield",  maxStacks: 1, labelKey: "upgrade_shield" },
] as const;

/** Magnitude applied per stack for each upgrade type. */
export const UPGRADE_MAGNITUDES = {
  /** Multiplier added per stack: +0.15 per stack = +15% speed. */
  speedMultPerStack: 0.15,
  /** Seconds added to homing delay per stack (base 3s, max 6s). */
  homingDelaySecPerStack: 1,
  /** Seconds removed from split cooldown per stack (base 6s, min 3s). */
  splitCooldownReductionPerStack: 1,
} as const;
