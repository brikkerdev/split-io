// Bot population + AI profiles. GDD §3, §9.

export type BotProfileId =
  | "aggressor"
  | "tourist"
  | "hoarder"
  | "carver"
  | "coward";

export interface BotProfile {
  id: BotProfileId;
  splitCooldownMult: number;
  /** Radius in which this bot reacts to enemies (chase or flee). */
  aggressionRadiusCells: number;
  /** Trail length the bot tries to draw before closing. */
  preferredTrailLen: number;
  /** Probability weight in spawn pool. */
  weight: number;
  /** Radius of the typical loop around home (cells). */
  loopRadiusCells: number;
  /** If an enemy gets this close while the bot is on its trail, it flees. */
  fleeRadiusCells: number;
  /** 0 = timid, 1 = reckless. Drives risk thresholds and lookahead behaviour. */
  boldness: number;
  /** When true, bot prefers hero trail over bot trails as a target. */
  huntsHero: boolean;
  /** When true, bot heads for the largest enemy territory to carve into it. */
  carvesEnemyLand: boolean;
}

export const BOTS = {
  countMin: 15,
  countMax: 25,
  countDefault: 20,

  profiles: [
    {
      id: "aggressor",
      splitCooldownMult: 0.85,
      aggressionRadiusCells: 22,
      preferredTrailLen: 22,
      weight: 0.28,
      loopRadiusCells: 8,
      fleeRadiusCells: 3,
      boldness: 0.85,
      huntsHero: true,
      carvesEnemyLand: false,
    },
    {
      id: "tourist",
      splitCooldownMult: 1.4,
      aggressionRadiusCells: 6,
      preferredTrailLen: 12,
      weight: 0.28,
      loopRadiusCells: 5,
      fleeRadiusCells: 6,
      boldness: 0.35,
      huntsHero: false,
      carvesEnemyLand: false,
    },
    {
      id: "hoarder",
      splitCooldownMult: 1.1,
      aggressionRadiusCells: 8,
      preferredTrailLen: 18,
      weight: 0.2,
      loopRadiusCells: 10,
      fleeRadiusCells: 5,
      boldness: 0.55,
      huntsHero: false,
      carvesEnemyLand: false,
    },
    {
      id: "carver",
      splitCooldownMult: 1.0,
      aggressionRadiusCells: 14,
      preferredTrailLen: 26,
      weight: 0.14,
      loopRadiusCells: 14,
      fleeRadiusCells: 4,
      boldness: 0.9,
      huntsHero: false,
      carvesEnemyLand: true,
    },
    {
      id: "coward",
      splitCooldownMult: 1.5,
      aggressionRadiusCells: 12,
      preferredTrailLen: 7,
      weight: 0.1,
      loopRadiusCells: 4,
      fleeRadiusCells: 9,
      boldness: 0.15,
      huntsHero: false,
      carvesEnemyLand: false,
    },
  ] satisfies BotProfile[],

  // Aggression scales with player territory share.
  aggressionVsPlayerCurve: [
    { playerPct: 0,  mult: 0.6 },
    { playerPct: 10, mult: 1.0 },
    { playerPct: 30, mult: 1.5 },
    { playerPct: 60, mult: 2.0 },
  ],

  firstRunCount: 8,
  firstRunPassive: true,

  /** Cells looked ahead along heading for self/wall avoidance. */
  lookaheadCells: 4,
  /** Hero velocity is multiplied by this (seconds) when leading aim. */
  heroLeadSec: 0.55,
  /** Enemy territory below this fraction is ignored by carver targeting. */
  carverMinEnemyPct: 0.05,

  ghost: {
    cooldownSec: 7,
    cooldownJitter: 0.25,
    speedMult: 2.0,
    preflySec: 0.4,
    maxLifetimeSec: 5,
    spawnGuardCells: 2,
    inOwnHomeMaxSec: 0.5,
    /** Min trail length (cells) before bot is allowed to fire a ghost. */
    minTrailLenCells: 4,
  },
} as const;

export type BotsConfig = typeof BOTS;
