// Render tuning constants. All values in world/pixel units unless noted.

export const RENDER = {
  // Trail rendering
  trail: {
    heroLineWidth: 6,
    ghostLineWidth: 5,
    botLineWidth: 4,
    heroAlpha: 0.78,
    ghostAlpha: 0.68,
    botAlpha: 0.62,
    /** Min distance between posHistory samples in pixels. */
    sampleDistPx: 4,
    /** Max posHistory entries per unit. */
    maxHistoryLen: 512,
  },

  // Territory rendering
  territory: {
    fillAlpha: 0.82,
    shadowOffsetPx: 3,
    shadowAlpha: 0.08,
    bevelPx: 2,
    bevelHiAmount: 0.25,
    bevelLoAmount: -0.2,
    bevelAlpha: 0.55,
    /** Inset for rounded rect fallback (px). */
    roundedRectRadius: 2,
    /** Overlap inset so adjacent filled cells merge visually. */
    fillInset: 0,
  },

  // Boundary stroke for territory polygon
  contour: {
    lineWidth: 2,
    alpha: 0.95,
  },

  // Camera
  camera: {
    /** Phaser startFollow lerp factor (0..1). Higher = snappier. 0.18 ≈ tight tracking. */
    followLerp: 0.18,
    /** Look-ahead multiplier: camera target offset = heroVelocity * lookAheadSec. */
    lookAheadSec: 0.2,
    /** Max zoom (stationary hero). */
    zoomMax: 2.0,
    /** Min zoom (full-speed hero). */
    zoomMin: 1.85,
    /** Per-frame lerp factor for zoom transitions. */
    zoomLerp: 0.05,
  },

  // JuiceSystem shake throttle
  shakeThrottleMs: 200,
} as const;

export type RenderConfig = typeof RENDER;
