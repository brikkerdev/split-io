// Soft currency + daily reward. GDD §3 §5, persona insight #8.

export const ECONOMY = {
  startingCoins: 0,
  dailyRewardCoins: 50,
  dailyRewardCooldownMs: 24 * 60 * 60 * 1000,

  rewardedDoubleMult: 2,
  rewardMultiplier: 1,
  costGrowthRate: 1.25,

  /** Award 1 coin per this many percent of territory gained. GDD §5. */
  coinsPerTerritoryStepPct: 2,
  /** Coins awarded per kill (trail cut where killer=hero, victim!=hero). GDD §5. */
  coinsPerKill: 1,
} as const;

export type EconomyConfig = typeof ECONOMY;
