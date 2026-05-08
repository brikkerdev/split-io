import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@config/juice", () => ({
  JUICE: {
    capture: {
      shakeIntensity: 0.008,
      shakeDurationMs: 80,
      flashColor: 0xffffff,
      flashDurationMs: 120,
      particleCount: 24,
    },
    death: {
      rgbSplitDurationMs: 400,
      slowMoScale: 0.15,
      slowMoDurationMs: 400,
      shakeIntensity: 0.014,
      shakeDurationMs: 200,
    },
    ghostSpawn: { particleCount: 12, particleColor: 0xff3df0 },
    particle: { speed: { min: 60, max: 180 }, lifespan: 500, scale: { start: 1, end: 0 }, maxConcurrent: 100 },
  },
}));

vi.mock("@events/GameEvents", () => ({
  GameEvents: {
    TerritoryCaptured: "territory:captured",
    TrailCut: "trail:cut",
    PlayerDied: "player:died",
    GhostSpawned: "ghost:spawned",
  },
}));

// Stub phaser so `import Phaser from "phaser"` works without a DOM.
vi.mock("phaser", () => ({
  default: { BlendModes: { ADD: 1 } },
}));

// Minimal Phaser scene mock.
function makeScene() {
  const emitter = {
    setParticleTint: vi.fn(),
    explode: vi.fn(),
    destroy: vi.fn(),
  };

  const graphics = {
    fillStyle: vi.fn(),
    fillCircle: vi.fn(),
    generateTexture: vi.fn(),
    destroy: vi.fn(),
  };

  const rectObj = {
    setBlendMode: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };

  const camera = {
    shake: vi.fn(),
    flash: vi.fn(),
    scrollX: 0,
    scrollY: 0,
    width: 800,
    height: 600,
  };

  const time = {
    timeScale: 1,
    now: 0,
    delayedCall: vi.fn((ms: number, cb: () => void) => {
      cb();
    }),
  };

  const tweens = { timeScale: 1 };

  const listeners: Record<string, Array<(arg?: unknown) => void>> = {};

  const events = {
    on: vi.fn((key: string, cb: (arg?: unknown) => void) => {
      if (!listeners[key]) listeners[key] = [];
      listeners[key]!.push(cb);
    }),
    off: vi.fn(),
    emit: (key: string, payload?: unknown) => {
      for (const cb of listeners[key] ?? []) cb(payload);
    },
  };

  const add = {
    particles: vi.fn(() => emitter),
    rectangle: vi.fn(() => rectObj),
  };

  const make = {
    graphics: vi.fn(() => graphics),
  };

  return { cameras: { main: camera }, time, tweens, events, add, make, _emitter: emitter };
}

import { JuiceSystem } from "../src/systems/JuiceSystem";

describe("JuiceSystem", () => {
  let scene: ReturnType<typeof makeScene>;
  let juice: JuiceSystem;

  beforeEach(() => {
    scene = makeScene();
    juice = new JuiceSystem(scene as unknown as import("phaser").Scene);
    juice.setHeroId(1);
  });

  it("shake calls camera.shake", () => {
    juice.shake(0.01, 100);
    expect(scene.cameras.main.shake).toHaveBeenCalledWith(100, 0.01);
  });

  it("flash decomposes color and calls camera.flash", () => {
    juice.flash(0xff8040, 200);
    expect(scene.cameras.main.flash).toHaveBeenCalledWith(200, 0xff, 0x80, 0x40, false);
  });

  it("slowMo sets timeScale immediately", () => {
    scene.time.timeScale = 1;
    juice.slowMo(0.15, 400);
    // timeScale is set to slowMo value immediately
    expect(scene.time.timeScale).toBe(0.15);
    // restore happens via real-time setTimeout (not scene delayedCall)
    expect(scene.tweens.timeScale).toBe(0.15);
  });

  it("particleBurst calls emitter.explode with correct args", () => {
    juice.particleBurst(100, 200, 10, 0xff0000);
    expect(scene._emitter.setParticleTint).toHaveBeenCalledWith(0xff0000);
    expect(scene._emitter.explode).toHaveBeenCalledWith(10, 100, 200);
  });

  it("destroy removes all event listeners", () => {
    juice.destroy();
    expect(scene.events.off).toHaveBeenCalledTimes(6);
  });

  it("territory:captured event triggers flash + shake + burst without throwing", () => {
    expect(() =>
      scene.events.emit("territory:captured", { ownerId: 1, cells: 50, pct: 10 }),
    ).not.toThrow();
    expect(scene.cameras.main.flash).toHaveBeenCalled();
    expect(scene.cameras.main.shake).toHaveBeenCalled();
    expect(scene._emitter.explode).toHaveBeenCalled();
  });

  it("player:died event triggers rgb layers + slowMo without throwing", () => {
    expect(() =>
      scene.events.emit("player:died", { score: 100, reason: "trail_cut" }),
    ).not.toThrow();
    expect(scene.add.rectangle).toHaveBeenCalled();
  });

  it("ghost:spawned event triggers particle burst without throwing", () => {
    expect(() =>
      scene.events.emit("ghost:spawned", { id: 1 }),
    ).not.toThrow();
    expect(scene._emitter.explode).toHaveBeenCalled();
  });
});
