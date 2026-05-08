import Phaser from "phaser";
import { GameEvents } from "@events/GameEvents";
import { AUDIO } from "@config/audio";
import { JUICE } from "@config/juice";
import { RENDER } from "@config/render";
import type { TerritoryCapturedPayload, TrailCutPayload, GhostSpawnedPayload } from "@gametypes/events";

export class JuiceSystem {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rgbLayers: Phaser.GameObjects.Rectangle[] = [];
  private lastShakeMs = -Infinity;
  private slowMoHandle: number | null = null;
  private heroId = 0;

  constructor(private scene: Phaser.Scene) {
    this.emitter = this.createEmitter();
    this.bindEvents();
  }

  /** Bind which owner id is the player. Effects fire only for this owner. */
  setHeroId(id: number): void {
    this.heroId = id;
  }

  // ---- Public API ----

  shake(intensity: number, duration: number): void {
    this.scene.cameras.main.shake(duration, intensity);
  }

  flash(color: number, duration: number): void {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    this.scene.cameras.main.flash(duration, r, g, b, false);
  }

  slowMo(timeScale: number, durationMs: number): void {
    this.scene.time.timeScale = timeScale;
    this.scene.tweens.timeScale = timeScale;
    // Use globalThis.setTimeout so the callback fires after real-world ms,
    // not scaled game time (which would extend the slow-mo indefinitely).
    if (this.slowMoHandle !== null) {
      clearTimeout(this.slowMoHandle);
    }
    this.slowMoHandle = globalThis.setTimeout(() => {
      this.scene.time.timeScale = 1;
      this.scene.tweens.timeScale = 1;
      this.slowMoHandle = null;
    }, durationMs) as unknown as number;
  }

  private playSfx(key: string, volume = 0.7): void {
    try {
      if (this.scene.cache.audio.exists(key)) {
        this.scene.sound.play(key, { volume });
      }
    } catch { /* silent */ }
  }

  particleBurst(x: number, y: number, count: number, color: number): void {
    if (!this.emitter) return;
    this.emitter.setParticleTint(color);
    this.emitter.explode(count, x, y);
  }

  // ---- Private helpers ----

  private createEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | null {
    try {
      const gfx = this.scene.make.graphics({ x: 0, y: 0 });
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(4, 4, 4);
      gfx.generateTexture("_juice_particle", 8, 8);
      gfx.destroy();

      const emitter = this.scene.add.particles(0, 0, "_juice_particle", {
        speed: { min: JUICE.particle.speed.min, max: JUICE.particle.speed.max },
        lifespan: JUICE.particle.lifespan,
        scale: { start: JUICE.particle.scale.start, end: JUICE.particle.scale.end },
        emitting: false,
        maxParticles: JUICE.particle.maxConcurrent,
      });
      return emitter;
    } catch {
      return null;
    }
  }

  private bindEvents(): void {
    const ev = this.scene.events;

    ev.on(GameEvents.TerritoryCaptured, (payload: TerritoryCapturedPayload) => {
      // Only react to hero captures — bots never trigger visual juice.
      if (this.heroId === 0 || payload.ownerId !== this.heroId) return;
      this.playSfx(AUDIO.sfx.capture, 0.55);
      this.flash(JUICE.capture.flashColor, JUICE.capture.flashDurationMs);
      const nowMs = this.scene.time.now;
      if (nowMs - this.lastShakeMs >= RENDER.shakeThrottleMs) {
        this.lastShakeMs = nowMs;
        this.shake(JUICE.capture.shakeIntensity, JUICE.capture.shakeDurationMs);
      }
      const cam = this.scene.cameras.main;
      this.particleBurst(
        cam.scrollX + cam.width / 2,
        cam.scrollY + cam.height / 2,
        JUICE.capture.particleCount,
        JUICE.capture.flashColor,
      );
    });

    ev.on(GameEvents.TrailCut, (payload: TrailCutPayload) => {
      // Only react when hero is involved (as victim or killer).
      if (this.heroId === 0) return;
      if (payload.victim !== this.heroId && payload.killer !== this.heroId) return;
      // Player dies → handled by PlayerDied below. Player kills enemy → small flash only.
      if (payload.killer === this.heroId && payload.victim !== this.heroId) {
        this.playSfx(AUDIO.sfx.victory, 0.5);
        this.flash(JUICE.capture.flashColor, JUICE.capture.flashDurationMs);
      }
    });

    ev.on(GameEvents.PlayerDied, () => {
      this.playSfx(AUDIO.sfx.death, 0.85);
      this.triggerRgbSplit(JUICE.death.rgbSplitDurationMs);
      this.slowMo(JUICE.death.slowMoScale, JUICE.death.slowMoDurationMs);
      this.shake(JUICE.death.shakeIntensity, JUICE.death.shakeDurationMs);
    });

    ev.on(GameEvents.UpgradeApplied, () => {
      this.playSfx(AUDIO.sfx.upgrade, 0.65);
    });

    ev.on(GameEvents.UpgradeOffer, () => {
      this.playSfx(AUDIO.sfx.warning, 0.5);
    });

    ev.on(GameEvents.GhostSpawned, (payload: GhostSpawnedPayload) => {
      void payload;
      // Ghost is hero-only; safe to react unconditionally, but gate for safety.
      if (this.heroId === 0) return;
      this.playSfx(AUDIO.sfx.split, 0.7);
      const cam = this.scene.cameras.main;
      this.particleBurst(
        cam.scrollX + cam.width / 2,
        cam.scrollY + cam.height / 2,
        JUICE.ghostSpawn.particleCount,
        JUICE.ghostSpawn.particleColor,
      );
    });
  }

  private triggerRgbSplit(durationMs: number): void {
    this.clearRgbLayers();
    const cam = this.scene.cameras.main;
    const w = cam.width;
    const h = cam.height;

    const layers: Array<{ color: number; ox: number; oy: number }> = [
      { color: 0xff0000, ox: -6, oy: 0 },
      { color: 0x00ff00, ox: 6, oy: 0 },
      { color: 0x0000ff, ox: 0, oy: 4 },
    ];

    for (const { color, ox, oy } of layers) {
      const rect = this.scene.add
        .rectangle(cam.scrollX + w / 2 + ox, cam.scrollY + h / 2 + oy, w, h, color, 0.15)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(999);
      this.rgbLayers.push(rect);
    }

    this.scene.time.delayedCall(durationMs, () => this.clearRgbLayers());
  }

  private clearRgbLayers(): void {
    for (const r of this.rgbLayers) r.destroy();
    this.rgbLayers = [];
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryCaptured);
    this.scene.events.off(GameEvents.TrailCut);
    this.scene.events.off(GameEvents.PlayerDied);
    this.scene.events.off(GameEvents.GhostSpawned);
    this.scene.events.off(GameEvents.UpgradeApplied);
    this.scene.events.off(GameEvents.UpgradeOffer);
    this.clearRgbLayers();
    if (this.slowMoHandle !== null) {
      clearTimeout(this.slowMoHandle);
      this.slowMoHandle = null;
      this.scene.time.timeScale = 1;
      this.scene.tweens.timeScale = 1;
    }
    this.emitter?.destroy();
    this.emitter = null;
  }
}
