// Ghost lifecycle tuning. Source: GDD §2 ghost lifecycle.

export const GHOST = {
  preflySec: 3,
  maxLifetimeSec: 7,
  homingArcRadiusCellsMin: 4,
  homingArcRadiusCellsMax: 6,
  homingTurnRateRadPerSec: 4,
  inOwnHomeMaxSec: 0.5,

  fallbackSpeedMult: 1.1,
  homingDelayBonusMaxSec: 6,
  homingDelayUpgradeStepSec: 1,

  trailHueShift: 0.08,

  /**
   * Spawn guard radius (in grid cells). Ghost does not record its trail nor
   * test for collisions until it has moved past this distance from spawn.
   * Prevents instant loop-closure when ghost spawns on hero's active trail.
   */
  spawnGuardCells: 2,

  cooldownBaseSec: 6,
  cooldownFirstRoundSec: 4,
  cooldownMinSec: 3,
  cooldownStepSec: 1,
} as const;

export type GhostConfig = typeof GHOST;
