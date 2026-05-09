// In-round upgrade pool. Source: GDD §3.

export type UpgradeId =
  | "ghostSpeed"
  | "ghostLifetime"
  | "ghostCooldown"
  | "passiveSpeed";

export interface UpgradeDef {
  id: UpgradeId;
  iconKey: string;
  maxStacks: number;
  labelKey: string;
  descKey: string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: "ghostSpeed",    iconKey: "ph-rocket",               maxStacks: 3, labelKey: "upgrade_ghostSpeed",    descKey: "upgrade_ghostSpeed_desc" },
  { id: "ghostLifetime", iconKey: "ph-clock-counter-clockwise", maxStacks: 3, labelKey: "upgrade_ghostLifetime", descKey: "upgrade_ghostLifetime_desc" },
  { id: "ghostCooldown", iconKey: "ph-timer",                maxStacks: 3, labelKey: "upgrade_ghostCooldown",  descKey: "upgrade_ghostCooldown_desc" },
  { id: "passiveSpeed",  iconKey: "ph-gauge",                maxStacks: 3, labelKey: "upgrade_passiveSpeed",   descKey: "upgrade_passiveSpeed_desc" },
] as const;

export const UPGRADE_MAGNITUDES = {
  ghostSpeedMultPerStack: 0.25,
  ghostLifetimeSecPerStack: 1.5,
  ghostCooldownReductionPerStack: 1,
  passiveSpeedMultPerStack: 2 / 9,
  passiveSpeedCapMult: 5 / 3,
} as const;
