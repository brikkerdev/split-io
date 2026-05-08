import type { OwnerId } from "./unit";

export interface RoundBreakdown {
  territoryPct: number;
  territoryPoints: number;
  secondsBonus: number;
  kills: number;
  killPoints: number;
  penalty: number;
  total: number;
  rank: number;
  bestNew: boolean;
}

export interface LeaderboardEntryView {
  ownerId: OwnerId;
  name: string;
  pct: number;
  isPlayer: boolean;
  color: number;
}
