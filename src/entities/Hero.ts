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

  // ── Upgrade bonus fields ──────────────────────────────────

  /** Cumulative ghost speed bonus multiplier (+0.25 per ghostSpeed stack). */
  ghostSpeedBonusMult = 0;

  /** Extra seconds added to ghost maxLifetime (+1.5 per ghostLifetime stack). */
  ghostLifetimeBonusSec = 0;

  /** Total cooldown reduction in seconds (−1 per ghostCooldown stack). */
  ghostCooldownReductionSec = 0;

  /** Cumulative passive speed bonus multiplier (+0.12 per passiveSpeed stack). */
  passiveSpeedBonusMult = 0;

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
