import { MAP } from "@config/map";
import { ARENA_DISC_INRADIUS_FACTOR } from "@systems/PolygonTerritorySystem";

export interface SlideResult {
  x: number;
  y: number;
  /** True when the proposed move was deflected by the arena boundary. */
  hit: boolean;
  /** Heading along which the actor slid. Equals atan2(dy, dx) when not deflected. */
  heading: number;
}

/**
 * Circular-arena boundary as a sliding wall. If the proposed move would
 * exit the arena disc, rotate the displacement onto the tangent at the
 * contact point — preserving magnitude — instead of clamping radially
 * (which would otherwise eat the actor's speed and stall it on the rim).
 */
export interface SlideOpts {
  /**
   * Bias the slide direction along this vector instead of along (dx, dy).
   * Use the actor's prior motion so an input reversal at the rim can't
   * flip the heading 180° in a single frame and drag the actor across its
   * own trail. If omitted, sign is chosen from (dx, dy).
   */
  preferredDirX: number;
  preferredDirY: number;
  /**
   * True if the actor ended last frame on the arena rim. When set and the
   * proposed move would land inside the disc but is anti-aligned with the
   * preferred direction, the slide is still applied — using `cur` as the
   * rim point. Without this, an actor riding the curving upper arc
   * detaches as soon as input flips inward, because the proposed point
   * sits inside R; the heading then snaps to the input and the actor
   * crosses its own trail.
   */
  wasOnRim?: boolean;
}

export function arenaSlide(
  curX: number,
  curY: number,
  dx: number,
  dy: number,
  opts?: SlideOpts,
): SlideResult {
  const newX = curX + dx;
  const newY = curY + dy;
  const ddx = newX - MAP.centerX;
  const ddy = newY - MAP.centerY;
  const r2 = ddx * ddx + ddy * ddy;
  // Clamp to the territory polygon's inradius, not the raw arena circle. The
  // arenaDisc is an inscribed N-gon, so points on the actual circle land
  // outside the polygon between vertices and ownerAt() returns neutral —
  // a ghost sliding along the rim past its own home would otherwise never
  // satisfy the closure check.
  const R = MAP.radiusPx * ARENA_DISC_INRADIUS_FACTOR;

  const prefMag = opts !== undefined
    ? Math.hypot(opts.preferredDirX, opts.preferredDirY)
    : 0;

  // Rim-stickiness: when actor was on rim last frame and the new input pulls
  // backward (anti-aligned with prior motion), keep sliding along the rim
  // instead of letting the proposal drift inward and free-flip the heading.
  // Forward-aligned input still detaches naturally.
  let useRimAt: "new" | "cur" | null = null;
  if (r2 > R * R) {
    useRimAt = "new";
  } else if (opts?.wasOnRim === true && prefMag > 1e-3) {
    const fwdDot = opts.preferredDirX * dx + opts.preferredDirY * dy;
    if (fwdDot < 0) useRimAt = "cur";
  }

  if (useRimAt === null) {
    return { x: newX, y: newY, hit: false, heading: Math.atan2(dy, dx) };
  }

  const baseX = useRimAt === "new" ? ddx : curX - MAP.centerX;
  const baseY = useRimAt === "new" ? ddy : curY - MAP.centerY;
  const dist = Math.sqrt(baseX * baseX + baseY * baseY) || 1;
  const nx = baseX / dist;
  const ny = baseY / dist;

  let tx = -ny;
  let ty = nx;

  // Sign selection: prefer the actor's prior motion when supplied (locks
  // the rim slide so the player can't U-turn straight onto their own
  // trail). Fall back to the input displacement when no preference is
  // given or the preference is degenerate (e.g. spawn frame).
  if (opts !== undefined && prefMag > 1e-3) {
    if (opts.preferredDirX * tx + opts.preferredDirY * ty < 0) {
      tx = -tx;
      ty = -ty;
    }
  } else if (dx * tx + dy * ty < 0) {
    tx = -tx;
    ty = -ty;
  }

  const len = Math.hypot(dx, dy);
  let resX = curX + tx * len;
  let resY = curY + ty * len;

  const ex = resX - MAP.centerX;
  const ey = resY - MAP.centerY;
  const e2 = ex * ex + ey * ey;
  if (e2 > R * R) {
    const k = R / Math.sqrt(e2);
    resX = MAP.centerX + ex * k;
    resY = MAP.centerY + ey * k;
  }

  return { x: resX, y: resY, hit: true, heading: Math.atan2(ty, tx) };
}
