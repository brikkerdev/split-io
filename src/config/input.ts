// Input system tuning. Source: GDD §4.
export const INPUT = {
  /** Radians/sec max turn rate for smooth heading interpolation. */
  turnRateRadPerSec: 1000,

  /** If raw heading delta < this (rad), skip update to avoid micro-jitter. */
  headingHysteresisRad: 0,

  /** Exponential smoothing factor applied to raw input heading [0..1]. Lower = smoother but laggier. */
  rawSmoothingFactor: 1,

  /**
   * Minimum pointer-to-hero distance (px) to register a direction. Below this
   * the heading is frozen so the hero never tries to "reach" the cursor — it
   * just travels in the cursor's direction. Must comfortably exceed the hero's
   * turn radius (≈ speed / turnRate ≈ 19 world px), otherwise the hero orbits
   * the cursor when it falls behind.
   */
  deadzonePixels: 70,

  /** Minimum swipe distance (px) from touch start to register direction on mobile. */
  swipeDeadzonePixels: 12,

  /** Free-angle aim by default; set true for legacy 8-direction snap. */
  snapToSteps: false,
  directionSteps: 8,

  /** Floating stick outer circle radius in px. */
  stickRadiusPx: 64,

  /** Max ms from touchstart to touchend to count as a tap (split trigger). */
  tapMaxMs: 200,

  /** Max drag distance in px to still count as a tap. */
  tapMaxDragPx: 12,

  /**
   * Tiny rotation inertia after release. Per-frame multiplier at 60fps.
   * 0.4 → ~20ms tail. Total drift ≈ velocity * dt / (1-decay).
   */
  rotationInertiaDecay: 0.4,

  /** Fraction of last angular velocity preserved on release [0..1]. */
  rotationInertiaScale: 0,

  /** Max angular velocity (rad/sec) carried over after release. */
  maxRotationInertiaRadPerSec: 0,

  /** Below this |angular velocity| (rad/sec), inertia is treated as zero. */
  rotationInertiaEpsilon: 0.3,
} as const;

export type InputConfig = typeof INPUT;
