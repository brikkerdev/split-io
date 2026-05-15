// Round + actor movement tuning. Source: GDD §2, §2.1, §3.

// Mobile bot counts are roughly halved. Each extra alive bot adds an AI tick
// (pathfinding + collision queries) and a polygon to the territory render
// pipeline (earcut + 2 fillPath passes). Halving the population is the single
// biggest gain on integrated mobile GPUs that struggle with overdraw.
const IS_MOBILE = typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(pointer: coarse)").matches;

export const BALANCE = {
  roundSeconds: 180,
  longRoundSeconds: 300,

  heroBaseSpeedCellsPerSec: 10.5,
  heroTurnRateRadPerSec: 6,
  speedUpgradeMult: 0.15,

  splitCooldownSec: 6,
  splitCooldownFirstRoundSec: 4,
  splitCooldownMinSec: 3,

  shieldCooldownSec: 30,

  upgradeThresholdPct: 10,
  upgradeChoiceCount: 2,
  upgradeAutoCloseSec: 4,

  botCountMin: IS_MOBILE ? 8 : 15,
  botCountMax: IS_MOBILE ? 12 : 25,
  botCountFirstRound: IS_MOBILE ? 5 : 8,
  botFirstRoundPassiveSec: 30,

  killBonus: 500,
  killWallDeath: true,

  botBaseSpeedCellsPerSec: 9,
  botAggressorSpeedMult: 1.15,
  botTouristSpeedMult: 0.9,
  botHoarderSpeedMult: 1.0,
  botCarverSpeedMult: 1.1,
  botCowardSpeedMult: 0.95,

  /** Idle pause before a bot starts its next loop (seconds). */
  botIdleDurationSec: 1.5,
  /** Cells from home centre that counts as "inside home". */
  botHomeRadiusCells: 4,
  /** Max trail length before bot turns back (cells, per profile baseline). */
  botMaxTrailCells: 48,
  /** Steering turn rate for bots (radians per second). */
  botTurnRateRadPerSec: 3.5,

  /** Number of bots in demo/background mode (menu backdrop). */
  botCountDemoMode: IS_MOBILE ? 6 : 12,

  /** Spawn intro: hero is visible but immobile so player can read the field. */
  spawnGraceMs: 850,

  /** Minimum alive bot count regardless of how filled the map gets. */
  botCountClaimedFloor: 2,
} as const;

export type Balance = typeof BALANCE;
