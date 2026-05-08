// Bot population + AI profiles. GDD §3, §9.

export type BotProfileId = "aggressor" | "tourist" | "hoarder";

export interface BotProfile {
  id: BotProfileId;
  splitCooldownMult: number;
  aggressionRadiusCells: number;
  preferredTrailLen: number;
  weight: number;
}

export const BOTS = {
  countMin: 15,
  countMax: 25,
  countDefault: 20,

  profiles: [
    { id: "aggressor", splitCooldownMult: 0.85, aggressionRadiusCells: 18, preferredTrailLen: 22, weight: 0.35 },
    { id: "tourist",   splitCooldownMult: 1.4,  aggressionRadiusCells: 6,  preferredTrailLen: 10, weight: 0.4  },
    { id: "hoarder",   splitCooldownMult: 1.1,  aggressionRadiusCells: 10, preferredTrailLen: 16, weight: 0.25 },
  ] satisfies BotProfile[],

  // Aggression scales with player territory share.
  aggressionVsPlayerCurve: [
    { playerPct: 0,  mult: 0.6 },
    { playerPct: 10, mult: 1.0 },
    { playerPct: 30, mult: 1.4 },
    { playerPct: 60, mult: 1.8 },
  ],

  firstRunCount: 8,
  firstRunPassive: true,
} as const;

export type BotsConfig = typeof BOTS;
