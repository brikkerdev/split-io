// Score formula coefficients. Source: GDD §2.1.
// score = territoryPercent * tWeight + remainingSeconds * sWeight + kills * killBonus - deathPenalty

export const SCORE = {
  territoryWeight: 100,
  secondWeight: 5,
  killBonus: 500,
  deathPenalty: 0,

  leaderboardName: "score_round",
  bestScoreCelebrateDeltaPct: 0.05,
} as const;

export type ScoreConfig = typeof SCORE;
