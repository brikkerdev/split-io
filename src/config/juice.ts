// JuiceSystem tuning. All numbers are UI/camera units unless noted.

export const JUICE = {
  capture: {
    shakeIntensity: 0.004,
    shakeDurationMs: 60,
    flashColor: 0xa8e0c5,
    flashDurationMs: 80,
    particleCount: 16,
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
  particle: {
    speed: { min: 60, max: 180 },
    lifespan: 500,
    scale: { start: 1.0, end: 0 },
    maxConcurrent: 100,
  },
} as const;

export type JuiceConfig = typeof JUICE;
