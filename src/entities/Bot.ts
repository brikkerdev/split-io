import type { BotProfileId } from "@config/bots";
import type { Vec2 } from "@gametypes/geometry";
import type { Unit } from "@gametypes/unit";
import type { PatternId } from "@config/skinPatterns";

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
  /** Optional second tone for two-colour skins; `undefined` for monochrome. */
  colorSecondary?: number;
  /** Pattern overlay drawn on this bot's territory. */
  pattern: PatternId = "solid";
  /** Skin id this bot is wearing — drives rare-skin envy in players. */
  skinId: string = "";
  splitReadyAt = 0;

  state: BotState = "idle";
  /** Home spawn position in cell coords. */
  homeCx = 0;
  homeCy = 0;
  /** Current loop/cut target in cell coords (0 when none). */
  targetCx = 0;
  targetCy = 0;
  /**
   * World-space point the bot heads back to after a wedge run. Refreshed at
   * each returnHome transition to the nearest own-territory boundary point so
   * successive cycles start from different perimeter anchors instead of the
   * fixed spawn cell. Falls back to home cell when territory is empty.
   */
  returnX = 0;
  returnY = 0;
  /** How long the bot has been in current state (seconds). */
  stateElapsed = 0;
  /** Trail length at last cell quantisation. */
  trailLen = 0;
  /**
   * Per-bot greed multiplier randomized at spawn. Scales how far this bot
   * pushes from home before closing — high values make big land grabs,
   * low values make timid arcs. Adds visible variety between bots.
   */
  boldnessMult = 1;

  /**
   * World-space position history for smooth trail rendering.
   * Populated by BotAI while trail is active. Cleared on trail clear.
   */
  posHistory: Vec2[] = [];

  constructor(
    id: number,
    profile: BotProfileId,
    name: string,
    color: number,
    pattern: PatternId = "solid",
    skinId: string = "",
    colorSecondary?: number,
  ) {
    this.id = id;
    this.profile = profile;
    this.name = name;
    this.color = color;
    this.pattern = pattern;
    this.skinId = skinId;
    this.colorSecondary = colorSecondary;
  }
}
