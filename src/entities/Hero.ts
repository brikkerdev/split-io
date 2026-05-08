import type { Vec2 } from "@gametypes/geometry";
import type { Unit } from "@gametypes/unit";

/** Player-controlled hero. Methods are skeletons. */
export class Hero implements Unit {
  readonly id = 1;
  pos: Vec2 = { x: 0, y: 0 };
  heading = 0;
  speedCellsPerSec = 0;
  alive = true;

  /**
   * World-space position history for smooth trail rendering.
   * Populated by GameScene while trail is active.
   * Cleared when trail is cleared.
   */
  posHistory: Vec2[] = [];

  /** World-space velocity in px/sec. Updated by GameScene.moveHero each frame. */
  velocity: Vec2 = { x: 0, y: 0 };

  shieldActive = false;
  shieldReadyAt = 0;
  splitReadyAt = 0;
  homingDelayBonusSec = 0;

  // TODO: spawn(), update(dt), die(), applyUpgrade(id)
  spawn(_pos: Vec2): void {
    // TODO
  }

  update(_dt: number): void {
    // TODO: move along heading, write trail.
  }

  die(): void {
    // TODO
  }
}
