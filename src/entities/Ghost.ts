import type { Vec2 } from "@gametypes/geometry";
import type { OwnerId, Unit } from "@gametypes/unit";
import { GHOST } from "@config/ghost";

export type GhostPhase = "prefly" | "homing" | "fallback";

export class Ghost implements Unit {
  readonly id: number;
  pos: Vec2 = { x: 0, y: 0 };
  heading = 0;
  speedCellsPerSec = 0;
  alive = true;

  parentId: OwnerId;
  age = 0;
  phase: GhostPhase = "prefly";
  inHomeTimer = 0;
  /** World position recorded at spawn — used by GhostSystem to gate trail recording. */
  spawnPos: Vec2 = { x: 0, y: 0 };

  /** Effective prefly duration, may be extended by upgrades. */
  preflySec: number = GHOST.preflySec;

  /**
   * World-space position history for smooth trail rendering.
   * Populated by GhostSystem while trail is active. Cleared on trail clear.
   */
  posHistory: Vec2[] = [];

  constructor(id: number, parentId: OwnerId) {
    this.id = id;
    this.parentId = parentId;
  }

  spawn(pos: Vec2, heading: number, speed: number, preflySec: number): void {
    this.pos = { x: pos.x, y: pos.y };
    this.spawnPos = { x: pos.x, y: pos.y };
    this.heading = heading;
    this.speedCellsPerSec = speed;
    this.preflySec = preflySec;
    this.age = 0;
    this.phase = "prefly";
    this.inHomeTimer = 0;
    this.alive = true;
  }

  /**
   * Advance ghost state. Returns new phase if it changed, null otherwise.
   * Caller is responsible for homing steering (to avoid Vec2 math coupling).
   */
  tick(dt: number): GhostPhase | null {
    if (!this.alive) return null;
    this.age += dt;

    const prevPhase = this.phase;

    if (this.phase === "prefly" && this.age >= this.preflySec) {
      this.phase = "homing";
    } else if (this.phase === "homing" && this.age >= GHOST.maxLifetimeSec) {
      this.phase = "fallback";
    }

    // Advance position along heading
    const dist = this.speedCellsPerSec * dt;
    this.pos = {
      x: this.pos.x + Math.cos(this.heading) * dist,
      y: this.pos.y + Math.sin(this.heading) * dist,
    };

    return this.phase !== prevPhase ? this.phase : null;
  }

  /** Steer heading toward a target using a max turn rate. */
  steerToward(target: Vec2, maxTurnRadPerSec: number, dt: number): void {
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;

    const desired = Math.atan2(dy, dx);
    let delta = desired - this.heading;

    // Normalise to [-π, π]
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    const maxDelta = maxTurnRadPerSec * dt;
    const clamped = Math.max(-maxDelta, Math.min(maxDelta, delta));
    this.heading += clamped;
  }

  kill(): void {
    this.alive = false;
  }
}
