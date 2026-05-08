import type { BotProfileId } from "@config/bots";
import type { Vec2 } from "@gametypes/geometry";
import type { Unit } from "@gametypes/unit";

export type { BotProfileId as BotProfile };

export type BotState = "idle" | "leaveHome" | "cutOrLoop" | "returnHome";

export class Bot implements Unit {
  readonly id: number;
  pos: Vec2 = { x: 0, y: 0 };
  heading = 0;
  speedCellsPerSec = 0;
  alive = true;

  profile: BotProfileId;
  name: string;
  color: number;
  splitReadyAt = 0;

  state: BotState = "idle";
  /** Home spawn position in cell coords. */
  homeCx = 0;
  homeCy = 0;
  /** Current loop/cut target in cell coords (0 when none). */
  targetCx = 0;
  targetCy = 0;
  /** How long the bot has been in current state (seconds). */
  stateElapsed = 0;
  /** Trail length at last cell quantisation. */
  trailLen = 0;

  /**
   * World-space position history for smooth trail rendering.
   * Populated by BotAI while trail is active. Cleared on trail clear.
   */
  posHistory: Vec2[] = [];

  constructor(id: number, profile: BotProfileId, name: string, color: number) {
    this.id = id;
    this.profile = profile;
    this.name = name;
    this.color = color;
  }
}
