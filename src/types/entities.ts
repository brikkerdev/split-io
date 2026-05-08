import type { Vec2 } from "./grid";

export type ActorId = number;

export interface ActorState {
  id: ActorId;
  pos: Vec2;
  heading: Vec2;
  speedMult: number;
  alive: boolean;
}

export interface PlayerState extends ActorState {
  shieldReadyAt: number;
  shieldActive: boolean;
  splitReadyAt: number;
  homingDelayBonusSec: number;
}

export type GhostMode = "straight" | "homing" | "fallback";

export interface GhostState extends ActorState {
  ownerId: ActorId;
  spawnedAt: number;
  mode: GhostMode;
  inOwnTerritorySince: number;
}

export interface BotState extends ActorState {
  profileId: import("@config/bots").BotProfileId;
  splitReadyAt: number;
  targetActorId: ActorId | null;
}
