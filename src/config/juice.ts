// JuiceSystem tuning. All numbers are UI/camera units unless noted.

export const JUICE = {
  capture: {
    shakeIntensity: 0.004,
    shakeDurationMs: 60,
    flashColor: 0xa8e0c5,
    flashDurationMs: 80,
    particleCount: 16,
    floatText: {
      yOffset: -28,
      riseDist: 36,
      durationMs: 900,
      fontSize: 22,
      color: "#a8e0c5",
      strokeColor: "#0a1614",
      strokeThickness: 4,
      minPctToShow: 0.01,
    },
  },
  death: {
    rgbSplitDurationMs: 400,
    slowMoScale: 0.15,
    slowMoDurationMs: 400,
    shakeIntensity: 0.014,
    shakeDurationMs: 200,
  },
  ghostSpawn: {
    particleCount: 8,
    particleColor: 0xc9b8e8,
  },
  /** Transition played when a full cycle (100% capture) wraps. */
  cycleTransition: {
    /** Pre-fade quick white flash. */
    flashDurationMs: 220,
    flashColor: { r: 220, g: 240, b: 255 },
    /** Slow-mo applied while fading out. */
    slowMoScale: 0.45,
    /** Camera fade-out → reset → fade-in. */
    fadeOutMs: 320,
    fadeInMs: 420,
    fadeColor: { r: 220, g: 240, b: 255 },
    /** Centered "Cycle N" banner. */
    banner: {
      fontSize: 64,
      color: "#a8e0c5",
      strokeColor: "#0a1614",
      strokeThickness: 8,
      /** Scale-in tween. */
      scaleInDurationMs: 260,
      /** Hold visible at full scale. */
      holdMs: 520,
      /** Fade-out tween. */
      fadeOutMs: 360,
    },
    /** Camera shake on cycle start (after fade-in). */
    shakeIntensity: 0.006,
    shakeDurationMs: 220,
  },
  particle: {
    speed: { min: 60, max: 180 },
    lifespan: 500,
    scale: { start: 1.0, end: 0 },
    maxConcurrent: 100,
  },

  /** Ambient rising particles while hero is outside own territory. */
  outsideAmbient: {
    /** Particles emitted per second (spread over frames via accumulator). */
    particlesPerSec: 24,
    /** Vertical speed range (negative = upward), px/s. */
    vyMin: -60,
    vyMax: -30,
    /** Horizontal jitter range ±, px/s. */
    vxJitter: 20,
    alphaStart: 0.4,
    alphaEnd: 0,
    lifetimeMs: 600,
    /** Particle square half-size, px. */
    sizePx: 3,
    /** Fade-out duration when hero returns home, ms. */
    fadeOutMs: 200,
    /** Spawn radius around hero, px. */
    spawnRadiusPx: 18,
  },

  /** Flash + confetti at contour closure point. */
  contourClose: {
    flashAlphaStart: 0.8,
    flashDurationMs: 150,
    flashRadiusPx: 40,
    particleCount: 12,
    particleSpeedMin: 80,
    particleSpeedMax: 220,
    particleLifespan: 500,
  },

  /** Enhanced hero-kill (hero cuts a bot trail). */
  heroKill: {
    flashDurationMs: 150,
    shakeIntensity: 0.012,
    shakeDurationMs: 180,
  },

  /** Ghost expiry poof. */
  ghostExpiry: {
    particleCount: 6,
    particleColor: 0x9b7fc7,
    particleSpeedMin: 40,
    particleSpeedMax: 130,
    particleLifespan: 350,
  },

  /** Split cooldown ready glow around hero. */
  splitReady: {
    glowAlphaStart: 0.4,
    glowAlphaEnd: 0,
    glowScaleStart: 1.0,
    glowScaleEnd: 1.4,
    glowDurationMs: 250,
    glowRadiusPx: 28,
  },
  /** Effects while the hero is travelling on enemy territory (raiding). */
  raid: {
    /** Time to ramp intensity 0→1 while continuously inside enemy territory. */
    rampUpSec: 1.4,
    /** Time to decay intensity 1→0 once the hero leaves enemy territory. */
    rampDownSec: 0.35,

    /** Bite-mark "chewed" residue circles dropped along the hero path. */
    bite: {
      /** Spawn cadence at intensity=0..1 (ms between marks; lower = more frequent). */
      intervalMsAtZero: 110,
      intervalMsAtFull: 38,
      radiusPx: { min: 8, max: 16 },
      alpha: 0.55,
      fadeMs: 420,
      /** 0..1 — how much to grey-out the victim color before stamping. */
      desaturate: 0.6,
      /** Shade applied after desaturation (negative = darker). */
      shade: -0.18,
      /** Random lateral spread along hero motion, px. */
      lateralPx: 3,
    },

    /** Sparks/chips kicked outward from the hero. */
    spark: {
      intervalMsAtZero: 140,
      intervalMsAtFull: 50,
      countPerBurst: 2,
      desaturate: 0.45,
      shade: 0.05,
    },

    /** Synthesised "crunch" tick — WebAudio square wave with envelope. */
    sfx: {
      intervalMsAtZero: 240,
      intervalMsAtFull: 70,
      freqHzAtZero: 90,
      freqHzAtFull: 320,
      gainAtZero: 0.025,
      gainAtFull: 0.13,
      durationMs: 55,
      /** Random pitch jitter ±cents-equivalent (multiplier ±). */
      pitchJitter: 0.08,
    },
  },
} as const;

export type JuiceConfig = typeof JUICE;
