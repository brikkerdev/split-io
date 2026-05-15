// Ad cadence. Source: GDD §5, persona insight #3.

export const ADS = {
  interstitialCooldownMs: 60_000,
  interstitialEveryNthRound: 1,
  skipAfterFirstRound: false,

  continueRetainTerritoryPct: 0.7,
  continuePerRound: 1,
  continuePerHour: 3,

  rewardedDoubleCurrency: true,
} as const;

export type AdsConfig = typeof ADS;
