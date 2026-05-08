import type { Vec2 } from "./geometry";

/** Generic owner of trail + territory. Hero, Bot, Ghost extend this. */
export interface Unit {
  readonly id: number;
  pos: Vec2;
  /** Heading in radians. */
  heading: number;
  speedCellsPerSec: number;
  alive: boolean;
}

export type OwnerId = number;
