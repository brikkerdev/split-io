// Round + actor movement tuning. Source: GDD §2, §2.1, §3.

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

  botCountMin: 15,
  botCountMax: 25,
  botCountFirstRound: 8,
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
  botCountDemoMode: 12,
} as const;

export type Balance = typeof BALANCE;
