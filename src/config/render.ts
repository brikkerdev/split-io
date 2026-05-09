// Render tuning constants. All values in world/pixel units unless noted.

export const RENDER = {
  // Trail rendering
  trail: {
    heroLineWidth: 16,
    ghostLineWidth: 11,
    botLineWidth: 14,
    heroAlpha: 0.82,
    ghostAlpha: 0.7,
    botAlpha: 0.68,
    /** Min distance between posHistory samples in pixels. */
    sampleDistPx: 4,
    /** Max posHistory entries per unit. */
    maxHistoryLen: 512,
    /** Ghost trail dash pattern (px). */
    ghostDashPx: 11,
    ghostGapPx: 7,
    /** Fade-out duration for the ghost trail when the ghost dies (ms). */
    ghostFadeOutMs: 420,
    /**
     * Collision radius (in pixels) around a trail cell's centre. A unit only
     * dies when its centre is within this distance of the trail-cell centre.
     * Smaller than half a cell so the visual trail is visibly wider than the
     * lethal hitbox — gives the player a small forgive window.
     */
    colliderRadiusPx: 5,
    /**
     * Half-width of the territory captured along the trail polyline at
     * closure. A buffered strip of this radius is unioned with the loop
     * polygon so each pass adds visible thickness even on near-straight
     * runs. Should roughly match heroLineWidth/2.
     */
    captureHalfWidthPx: 9,
    /**
     * Douglas-Peucker tolerance applied to the trail polyline before
     * claim. Removes micro-jitter that would produce ragged lobes.
     */
    captureSimplifyTolPx: 2.5,
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

  // Boundary stroke for territory polygon (marching-squares smooth contour)
  contour: {
    lineWidth: 2,
    alpha: 0.95,
    /** Chaikin smoothing iterations (0 = no smoothing). */
    smoothIterations: 2,
    /** Drop-shadow offset in px for territory fill. */
    shadowOffsetPx: 5,
    /** Drop-shadow alpha. */
    shadowAlpha: 0.10,
    /** Inner edge highlight: lighter shade alpha. */
    innerHighlightAlpha: 0.45,
    /** Inner edge highlight line width in px. */
    innerHighlightWidth: 3,
    /** Lighter amount for inner highlight (0..1). */
    innerHighlightAmount: 0.28,
    /** Darker amount for outer stroke (-1..0). */
    outerStrokeDarken: -0.22,
  },

  // Camera
  camera: {
    /** Phaser startFollow lerp factor (0..1). Higher = snappier. 0.18 ≈ tight tracking. */
    followLerp: 0.18,
    /** Look-ahead multiplier: camera target offset = heroVelocity * lookAheadSec. */
    lookAheadSec: 0.2,
    /** Max zoom (stationary hero) — desktop. */
    zoomMax: 2.0,
    /** Min zoom (full-speed hero) — desktop. */
    zoomMin: 1.85,
    /** Max zoom (stationary hero) — mobile/touch. Pulled back so more arena fits. */
    zoomMaxMobile: 1.45,
    /** Min zoom (full-speed hero) — mobile/touch. */
    zoomMinMobile: 1.3,
    /** Per-frame lerp factor for zoom transitions. */
    zoomLerp: 0.05,
  },

  // JuiceSystem shake throttle
  shakeThrottleMs: 200,

  /** Duration of the territory dissolve animation when an owner dies (ms). */
  dissolveDurationMs: 720,

  /** Wave-fill animation when territory is captured (ms). */
  waveFillDurationMs: 220,
  waveFillEase: "Sine.easeOut" as const,

  /** Trail is lighter than territory fill by this HSL-lightness fraction. */
  trailLightenAmount: 0.25,
  /** Scale-in duration for each new trail segment (ms). */
  trailSegmentScaleInMs: 70,

  /** Three-phase bot death timings (ms). All ≤ dissolveDurationMs. */
  botDeath: {
    /** Faze 1: trail crumble fade duration. */
    trailFadeMs: 150,
    /** Faze 2: explosion burst fires at this offset. */
    explosionDelayMs: 150,
    /** Faze 2: explosion burst particle count. */
    explosionParticles: 25,
    /** Faze 2: explosion burst speed min px/s. */
    explosionSpeedMin: 60,
    /** Faze 2: explosion burst speed max px/s. */
    explosionSpeedMax: 120,
    /** Faze 2: white flash radius px. */
    flashRadiusPx: 40,
    /** Faze 3: dissolve starts at this offset (ms). */
    dissolveDelayMs: 350,
  },

  /** Crown update interval (ms). */
  crownUpdateMs: 200,
  /** Crown float amplitude in pixels. */
  crownFloatAmp: 3,
  /** Crown Y offset above entity center. */
  crownYOffset: -20,

  /** Trail origin pulse radius (px). */
  trailPulseRadius: 8,
  /** Trail origin pulse alpha min/max. */
  trailPulseAlphaMin: 0.6,
  trailPulseAlphaMax: 1.0,
  /** Trail origin pulse period (ms). */
  trailPulsePeriodMs: 800,
  /** Trail origin pulse scale min/max. */
  trailPulseScaleMin: 1.0,
  trailPulseScaleMax: 1.2,

  // HUD percent tick (task 2)
  hudPercentTick: {
    /** Duration of the number count-up animation on increase (ms). */
    tickDurationMs: 80,
    /** Duration of the CSS bounce scale animation (ms). */
    bounceDurationMs: 220,
  },

  // Hero squash-and-stretch on turn (task 7)
  heroSquash: {
    /** Duration of the squash tween (ms). */
    durationMs: 110,
    /** Squash amount: axis aligned with movement shrinks by this fraction. */
    amount: 0.15,
  },

  // Post-mortem zoom-out on death (task 10)
  postMortem: {
    /** Duration of the zoom-out camera tween (ms). */
    zoomMs: 700,
    /** Zoom factor: currentZoom * factor (clamped to 0.4 min). */
    zoomFactor: 0.55,
    /** Pause after zoom before showing GameOver modal (ms). */
    pauseMs: 200,
    /** Max alpha of the vignette overlay. */
    overlayAlpha: 0.3,
  },
} as const;

export type RenderConfig = typeof RENDER;
