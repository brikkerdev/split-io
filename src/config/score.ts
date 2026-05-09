// Score formula coefficients. Source: GDD §2.1.
// score = totalTerritoryCapturedPct * territoryPointsPerPct + cycleCount * cyclePoints + kills * killBonus - deathPenalty

export const SCORE = {
  killBonus: 500,
  cyclePoints: 1000,
  deathPenalty: 0,
  /** Points awarded per 1% of cumulative territory captured. */
  territoryPointsPerPct: 100,

  leaderboardName: "scoreround",
  bestScoreCelebrateDeltaPct: 0.05,
} as const;

export type ScoreConfig = typeof SCORE;
