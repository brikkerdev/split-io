// Soft currency + daily reward. GDD §3, persona insight #8.

export const ECONOMY = {
  startingCoins: 0,
  dailyRewardCoins: 50,
  dailyRewardCooldownMs: 24 * 60 * 60 * 1000,

  rewardedDoubleMult: 2,
  rewardMultiplier: 1,
  costGrowthRate: 1.25,
} as const;

export type EconomyConfig = typeof ECONOMY;
