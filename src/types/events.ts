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
  remaining: number;
  total: number;
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
  /** Percent of arena gained by this single capture event. */
  gainedPct?: number;
  /**
   * World-space seed point for wave-fill animation.
   * For trail closures: the closure point.
   * For transfer (bot kill): the position of the victim at death.
   */
  seedX?: number;
  seedY?: number;
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
  /** Polyline of the loop in world-coordinates. PolygonTerritorySystem claims via union. */
  polyline: readonly Vec2[];
  /**
   * Capture mode:
   * - "flood" (default): flood-fill the enclosed interior and claim it.
   * - "line": claim only the rasterized loop cells, no interior fill.
   */
  mode?: "flood" | "line";
  /** World-space closure point for wave-fill animation seed. */
  seedX?: number;
  seedY?: number;
}

export interface TrailCutPayload {
  victim: ActorId;
  killer: ActorId;
  /** World-space coordinates of the cut, if available. Used for FX positioning. */
  worldX?: number;
  worldY?: number;
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

export interface CoinEarnedPayload {
  amount: number;
  worldX: number;
  worldY: number;
  reason: "kill" | "territory" | "daily";
}

export interface CoinTotalPayload {
  total: number;
}
