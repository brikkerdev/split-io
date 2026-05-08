// Typed payload interfaces for GameEvents.

import type { ActorId, GhostMode } from "./entities";
import type { Vec2 } from "./grid";
import type { UpgradeId } from "./upgrades";

export interface ScoreUpdatePayload {
  score: number;
  delta: number;
}

export interface TimerTickPayload {
  remaining: number;
  total: number;
}

export interface CooldownUpdatePayload {
  ratio: number;
  ready: boolean;
}

export interface SplitFiredPayload {
  heading: Vec2;
}

export interface GhostSpawnedPayload {
  id: ActorId;
}

export interface GhostExpiredPayload {
  id: ActorId;
  reason: "capture" | "fallback" | "death";
  finalMode: GhostMode;
}

export interface TerritoryCapturedPayload {
  ownerId: ActorId;
  cells: number;
  pct: number;
}

export interface LeaderboardEntry {
  id: ActorId;
  name: string;
  color: number;
  percent: number;
  isHero: boolean;
  alive: boolean;
}

export interface LeaderboardUpdatePayload {
  entries: LeaderboardEntry[];
  heroRank: number;
  totalPlayers: number;
}

export interface KillHappenedPayload {
  killer: ActorId;
  victim: ActorId;
}

export interface UpgradeOfferPayload {
  choices: UpgradeId[];
}

export interface UpgradePickedPayload {
  id: UpgradeId;
}

export interface PlayerDiedPayload {
  score: number;
  reason: "wall" | "trail_cut" | "ghost_cut";
}

export interface RoundEndPayload {
  result: RoundResult;
}

export interface TrailCellAddedPayload {
  unitId: ActorId;
  cx: number;
  cy: number;
}

/** Emitted when a trail loop closes (hero↔ghost or trail↔own territory). */
export interface TrailClosedPayload {
  ownerId: ActorId;
  /** Packed cells (cy*cols+cx) that form the loop perimeter. */
  cells: readonly number[];
}

export interface TrailCutPayload {
  victim: ActorId;
  killer: ActorId;
}

export interface RoundResult {
  finalScore: number;
  territoryPct: number;
  remainingSec: number;
  kills: number;
  penalty: number;
  bestNew: boolean;
  rank: number;
}
