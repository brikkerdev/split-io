// Input system tuning. Source: GDD §4.
export const INPUT = {
  /** Radians/sec max turn rate for smooth heading interpolation. */
  turnRateRadPerSec: 6,

  /** If raw heading delta < this (rad), skip update to avoid micro-jitter. */
  headingHysteresisRad: 0.05,

  /** Exponential smoothing factor applied to raw input heading [0..1]. Lower = smoother but laggier. */
  rawSmoothingFactor: 0.3,

  /** Minimum pointer-to-hero distance (px) to register a direction. Below this = deadzone. */
  deadzonePixels: 28,

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
} as const;

export type InputConfig = typeof INPUT;
