import Phaser from "phaser";
import { GameEvents } from "@events/GameEvents";
import { AUDIO } from "@config/audio";
import { JUICE } from "@config/juice";
import { RENDER } from "@config/render";
import { desaturateColor, shadeColor } from "@utils/color";
import type { AudioManager } from "@systems/AudioManager";
import type { Hero } from "@entities/Hero";
import type {
  TerritoryCapturedPayload,
  TrailCutPayload,
  GhostSpawnedPayload,
  TrailClosedPayload,
  GhostExpiredPayload,
  CoinEarnedPayload,
} from "@gametypes/events";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class JuiceSystem {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rgbLayers: Phaser.GameObjects.Rectangle[] = [];
  private rgbClearHandle: Phaser.Time.TimerEvent | null = null;
  private lastShakeMs = -Infinity;
  private slowMoHandle: number | null = null;
  private heroId = 0;
  private hero: Hero | null = null;
  private audioManager: AudioManager | null = null;
  /** Returns the active ghost id (or null) so kill SFX fires for hero+ghost cuts. */
  private ghostIdProvider: (() => number | null) | null = null;

  // ---- Raid (hero on enemy territory) state ----
  private raidIntensity = 0;
  private raidBiteAccumMs = 0;
  private raidSparkAccumMs = 0;
  private raidSfxAccumMs = 0;
  private raidLastPos = { x: 0, y: 0, valid: false };
  private webAudioCtx: AudioContext | null = null;

  // ---- Ambient outside-own-territory emitter (task 3) ----
  private ambientEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private ambientActive = false;
  private ambientAccumSec = 0;
  private ambientPlayerColor = 0xffffff;
  private ambientFadeHandle: Phaser.Time.TimerEvent | null = null;

  // ---- Split-ready glow tracking (task 15) ----
  private lastSplitRatio = 0;
  private splitReadyFired = false;

  constructor(private scene: Phaser.Scene, audioManager?: AudioManager) {
    this.audioManager = audioManager ?? null;
    this.emitter = this.createEmitter();
    this.bindEvents();
  }

  /** Bind which owner id is the player. Effects fire only for this owner. */
  setHeroId(id: number): void {
    this.heroId = id;
  }

  /** Bind the hero entity so floating effects can anchor to its world position. */
  setHero(hero: Hero): void {
    this.hero = hero;
  }

  /** Provide a getter for the active ghost id; used by onTrailCut to detect hero kills via ghost trail. */
  setGhostIdProvider(fn: () => number | null): void {
    this.ghostIdProvider = fn;
  }

  // ---- Public API ----

  shake(intensity: number, duration: number): void {
    const overlay = typeof document !== "undefined"
      ? document.getElementById("ui-overlay")
      : null;
    if (!overlay) return;
    const cls = intensity >= 0.01 ? "shake-lg" : "shake-sm";
    overlay.classList.remove("shake-sm", "shake-lg");
    requestAnimationFrame(() => {
      overlay.classList.add(cls);
      globalThis.setTimeout(() => overlay.classList.remove(cls), duration + 40);
    });
  }

  flash(color: number, duration: number): void {
    const cam = this.scene.cameras.main;
    const overlay = this.scene.add
      .rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, color, 0.22)
      .setScrollFactor(0)
      .setDepth(1_000)
      .setOrigin(0.5);
    this.scene.tweens.add({
      targets: overlay,
      alpha: 0,
      duration,
      ease: "Quad.easeOut",
      onComplete: () => overlay.destroy(),
    });
  }

  slowMo(timeScale: number, durationMs: number): void {
    this.scene.time.timeScale = timeScale;
    this.scene.tweens.timeScale = timeScale;
    if (this.slowMoHandle !== null) {
      clearTimeout(this.slowMoHandle);
    }
    this.slowMoHandle = globalThis.setTimeout(() => {
      this.scene.time.timeScale = 1;
      this.scene.tweens.timeScale = 1;
      this.slowMoHandle = null;
    }, durationMs) as unknown as number;
  }

  particleBurst(x: number, y: number, count: number, color: number): void {
    if (!this.emitter) return;
    this.emitter.setParticleTint(color);
    this.emitter.explode(count, x, y);
  }

  /** Task 3: toggle ambient rising particles when hero is outside own territory. */
  setHeroOutsideOwnTerritory(active: boolean, playerColor?: number): void {
    if (playerColor !== undefined) this.ambientPlayerColor = playerColor;
    if (active === this.ambientActive) return;
    this.ambientActive = active;
    if (!active) {
      this.ambientFadeHandle?.remove(false);
      this.ambientFadeHandle = this.scene.time.delayedCall(
        JUICE.outsideAmbient.fadeOutMs,
        () => { this.ambientAccumSec = 0; },
      );
    }
  }

  /**
   * Per-frame call to emit ambient particles while outside own territory.
   * Must be called from update() alongside updateRaid().
   */
  tickAmbientOutside(dt: number): void {
    if (!this.ambientActive) return;
    if (!this.hero?.alive) return;
    const cfg = JUICE.outsideAmbient;
    this.ambientAccumSec += dt;
    const interval = 1 / cfg.particlesPerSec;
    while (this.ambientAccumSec >= interval) {
      this.ambientAccumSec -= interval;
      this.spawnAmbientParticle();
    }
  }

  /**
   * Task 6: flash + confetti burst at contour close point.
   */
  playContourClose(x: number, y: number, color: number): void {
    const cfg = JUICE.contourClose;

    // Radial confetti.
    if (this.emitter) {
      this.emitter.setParticleTint(color);
      this.emitter.setParticleSpeed(cfg.particleSpeedMin, cfg.particleSpeedMax);
      this.emitter.explode(cfg.particleCount, x, y);
      this.emitter.setParticleSpeed(JUICE.particle.speed.min, JUICE.particle.speed.max);
    }
  }

  /**
   * Task 13: ghost expiry poof particles + SFX.
   */
  playGhostExpiry(x: number, y: number): void {
    const cfg = JUICE.ghostExpiry;
    if (this.emitter) {
      this.emitter.setParticleTint(cfg.particleColor);
      this.emitter.setParticleSpeed(cfg.particleSpeedMin, cfg.particleSpeedMax);
      this.emitter.explode(cfg.particleCount, x, y);
      this.emitter.setParticleSpeed(JUICE.particle.speed.min, JUICE.particle.speed.max);
    }
    this.audioManager?.playGhostPuff();
  }

  /**
   * Task 15: glow + tick when split cooldown becomes ready.
   * Call this per-frame with the current 0–1 ratio from GhostSystem.
   */
  tickSplitCooldown(ratio: number): void {
    const wasReady = this.splitReadyFired;
    const isReady = ratio >= 1;
    if (isReady && !wasReady && this.lastSplitRatio < 1) {
      this.splitReadyFired = true;
      this.playSplitReadyFx();
    }
    if (!isReady) {
      this.splitReadyFired = false;
    }
    this.lastSplitRatio = ratio;
  }

  /**
   * Per-frame raid feedback: ticking SFX, bite-mark residue and sparks
   * while the hero is moving over enemy territory.
   *
   * @param dt          frame delta in seconds (already scene-paused-aware)
   * @param onEnemy     true while hero is on territory owned by someone else
   * @param victimColor color of the territory under the hero (or null when neutral)
   */
  updateRaid(dt: number, onEnemy: boolean, victimColor: number | null): void {
    if (!this.hero || !this.hero.alive) {
      this.raidIntensity = 0;
      this.raidLastPos.valid = false;
      return;
    }

    const cfg = JUICE.raid;
    const target = onEnemy && victimColor !== null ? 1 : 0;
    const ramp = target > this.raidIntensity ? cfg.rampUpSec : cfg.rampDownSec;
    const step = ramp > 0 ? dt / ramp : 1;
    if (target > this.raidIntensity) {
      this.raidIntensity = Math.min(1, this.raidIntensity + step);
    } else {
      this.raidIntensity = Math.max(0, this.raidIntensity - step);
    }

    if (this.raidIntensity <= 0.001 || victimColor === null) {
      this.raidLastPos.valid = false;
      return;
    }

    const dtMs = dt * 1000;
    const t = this.raidIntensity;

    // Bite-mark residue along the path.
    const biteInterval = lerp(cfg.bite.intervalMsAtZero, cfg.bite.intervalMsAtFull, t);
    this.raidBiteAccumMs += dtMs;
    while (this.raidBiteAccumMs >= biteInterval) {
      this.raidBiteAccumMs -= biteInterval;
      this.spawnBiteMark(victimColor);
    }

    // Outward sparks tinted with desaturated victim color.
    const sparkInterval = lerp(cfg.spark.intervalMsAtZero, cfg.spark.intervalMsAtFull, t);
    this.raidSparkAccumMs += dtMs;
    while (this.raidSparkAccumMs >= sparkInterval) {
      this.raidSparkAccumMs -= sparkInterval;
      this.spawnRaidSpark(victimColor);
    }

    // Rising synth tick.
    const sfxInterval = lerp(cfg.sfx.intervalMsAtZero, cfg.sfx.intervalMsAtFull, t);
    this.raidSfxAccumMs += dtMs;
    while (this.raidSfxAccumMs >= sfxInterval) {
      this.raidSfxAccumMs -= sfxInterval;
      this.playRaidTick(t);
    }

    this.raidLastPos.x = this.hero.pos.x;
    this.raidLastPos.y = this.hero.pos.y;
    this.raidLastPos.valid = true;
  }

  // ---- Bound event handlers ----

  private readonly onTerritoryCaptured = (payload: TerritoryCapturedPayload): void => {
    if (this.heroId === 0 || payload.ownerId !== this.heroId) return;
    this.playSfx(AUDIO.sfx.capture, 0.55, 350, 0.1);
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
    this.spawnCaptureFloatText(payload.gainedPct ?? 0);
  };

  private readonly onTrailCut = (payload: TrailCutPayload): void => {
    if (this.heroId === 0) return;
    if (payload.victim === this.heroId) return;
    const ghostId = this.ghostIdProvider?.() ?? null;
    const isHeroKill =
      payload.killer === this.heroId ||
      (ghostId !== null && payload.killer === ghostId);
    if (!isHeroKill) return;

    const cfg = JUICE.heroKill;
    this.playSfx(AUDIO.sfx.capture, 0.85, 220, 0.06);
    this.playSfx(AUDIO.sfx.victory, 0.45, 260, 0.08);
    this.audioManager?.playPaperRip();
    this.shake(cfg.shakeIntensity, cfg.shakeDurationMs);
    if (payload.worldX !== undefined && payload.worldY !== undefined) {
      this.particleBurst(payload.worldX, payload.worldY, 14, 0xffffff);
    }
  };

  private readonly onPlayerDied = (): void => {
    this.playSfx(AUDIO.sfx.death, 0.85);
    this.triggerRgbSplit(JUICE.death.rgbSplitDurationMs);
    this.slowMo(JUICE.death.slowMoScale, JUICE.death.slowMoDurationMs);
    this.shake(JUICE.death.shakeIntensity, JUICE.death.shakeDurationMs);
  };

  private readonly onUpgradeApplied = (): void => {
    this.playSfx(AUDIO.sfx.upgrade, 0.65);
  };

  private readonly onUpgradeOffer = (): void => {
    this.playSfx(AUDIO.sfx.warning, 0.5);
  };

  private readonly onGhostSpawned = (_payload: GhostSpawnedPayload): void => {
    if (this.heroId === 0) return;
    this.playSfx(AUDIO.sfx.split, 0.7);
    const cam = this.scene.cameras.main;
    this.particleBurst(
      cam.scrollX + cam.width / 2,
      cam.scrollY + cam.height / 2,
      JUICE.ghostSpawn.particleCount,
      JUICE.ghostSpawn.particleColor,
    );
  };

  private readonly onTrailClosed = (payload: TrailClosedPayload): void => {
    if (payload.ownerId !== this.heroId) return;
    const closePos = payload.polyline[payload.polyline.length - 1];
    const x = closePos?.x ?? this.hero?.pos.x ?? 0;
    const y = closePos?.y ?? this.hero?.pos.y ?? 0;
    this.playContourClose(x, y, this.ambientPlayerColor);
  };

  private readonly onGhostExpired = (_payload: GhostExpiredPayload): void => {
    const pos = this.hero?.pos;
    const x = pos?.x ?? 0;
    const y = pos?.y ?? 0;
    this.playGhostExpiry(x, y);
  };

  private readonly onCoinEarned = (_payload: CoinEarnedPayload): void => {
    this.audioManager?.playCoinPing();
  };

  private spawnAmbientParticle(): void {
    if (!this.hero) return;
    const cfg = JUICE.outsideAmbient;
    const r = cfg.spawnRadiusPx;
    const x = this.hero.pos.x + (Math.random() * 2 - 1) * r;
    const y = this.hero.pos.y + (Math.random() * 2 - 1) * r;

    const sz = cfg.sizePx;
    const rect = this.scene.add
      .rectangle(x, y, sz, sz, this.ambientPlayerColor, cfg.alphaStart)
      .setDepth(25);

    const vy = cfg.vyMin + Math.random() * (cfg.vyMax - cfg.vyMin);
    const vx = (Math.random() * 2 - 1) * cfg.vxJitter;
    const lifeSec = cfg.lifetimeMs / 1000;

    this.scene.tweens.add({
      targets: rect,
      x: rect.x + vx * lifeSec,
      y: rect.y + vy * lifeSec,
      alpha: cfg.alphaEnd,
      duration: cfg.lifetimeMs,
      ease: "Linear",
      onComplete: () => rect.destroy(),
    });
  }

  private playSplitReadyFx(): void {
    // Split-ready glow circle disabled — too noisy. Keep only the audio tick.
    this.audioManager?.playSplitReadyTick();
  }

  private spawnCaptureFloatText(gainedPct: number): void {
    if (!this.hero) return;
    const cfg = JUICE.capture.floatText;
    if (gainedPct < cfg.minPctToShow) return;
    const x = this.hero.pos.x;
    const y = this.hero.pos.y + cfg.yOffset;
    const text = `+${gainedPct.toFixed(2)}%`;
    const label = this.scene.add
      .text(x, y, text, {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: `${cfg.fontSize}px`,
        color: cfg.color,
        stroke: cfg.strokeColor,
        strokeThickness: cfg.strokeThickness,
      })
      .setOrigin(0.5, 1)
      .setDepth(900)
      .setScale(0.6);
    this.scene.tweens.add({
      targets: label,
      scale: 1,
      duration: 140,
      ease: "Back.easeOut",
    });
    this.scene.tweens.add({
      targets: label,
      y: y - cfg.riseDist,
      alpha: 0,
      duration: cfg.durationMs,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  // ---- Private helpers ----

  private spawnBiteMark(victimColor: number): void {
    if (!this.hero) return;
    const cfg = JUICE.raid.bite;
    const r = cfg.radiusPx.min + Math.random() * (cfg.radiusPx.max - cfg.radiusPx.min);
    const tint = shadeColor(desaturateColor(victimColor, cfg.desaturate), cfg.shade);

    // Drop slightly behind the hero so the mark trails the body, not overlaps it.
    const heading = this.hero.heading;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const back = 4 + Math.random() * 4;
    const lateral = (Math.random() * 2 - 1) * cfg.lateralPx;
    const x = this.hero.pos.x - cosH * back - sinH * lateral;
    const y = this.hero.pos.y - sinH * back + cosH * lateral;

    const arc = this.scene.add.circle(x, y, r, tint, cfg.alpha)
      // Above territory (DEPTH_TERRITORY=10), below trail (DEPTH_TRAIL=20).
      .setDepth(15);
    this.scene.tweens.add({
      targets: arc,
      alpha: 0,
      scale: 0.55,
      duration: cfg.fadeMs,
      ease: "Quad.easeOut",
      onComplete: () => arc.destroy(),
    });
  }

  private spawnRaidSpark(victimColor: number): void {
    if (!this.hero || !this.emitter) return;
    const cfg = JUICE.raid.spark;
    const tint = shadeColor(desaturateColor(victimColor, cfg.desaturate), cfg.shade);
    this.particleBurst(this.hero.pos.x, this.hero.pos.y, cfg.countPerBurst, tint);
  }

  private playRaidTick(intensity: number): void {
    const ctx = this.getWebAudioCtx();
    if (!ctx) return;
    if (ctx.state !== "running") {
      // Don't await — if the user hasn't interacted yet, just skip silently.
      void ctx.resume().catch(() => undefined);
      return;
    }

    const cfg = JUICE.raid.sfx;
    const baseFreq = lerp(cfg.freqHzAtZero, cfg.freqHzAtFull, intensity);
    const jitter = 1 + (Math.random() * 2 - 1) * cfg.pitchJitter;
    const freq = baseFreq * jitter;
    const peakGain = lerp(cfg.gainAtZero, cfg.gainAtFull, intensity)
      * this.getSfxVolumeScalar();
    if (peakGain <= 0.0005) return;

    const now = ctx.currentTime;
    const durSec = cfg.durationMs / 1000;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, now);
    // Slight downward sweep gives a "chomp" feel rather than pure beep.
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.7), now + durSec);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durSec + 0.01);
  }

  private getWebAudioCtx(): AudioContext | null {
    if (this.webAudioCtx) return this.webAudioCtx;
    const sm = this.scene.sound as Phaser.Sound.BaseSoundManager & { context?: AudioContext };
    if (sm.context) {
      this.webAudioCtx = sm.context;
      return this.webAudioCtx;
    }
    return null;
  }

  private getSfxVolumeScalar(): number {
    // Approximate the AudioManager's sfx volume so synthesized ticks honour the
    // user's settings slider. Falls back to scene volume.
    const sceneVol = this.scene.sound.volume;
    return Math.max(0, Math.min(1, sceneVol));
  }

  private playSfx(key: string, volume = 0.7, detuneCents = 150, volumeJitter = 0.08): void {
    try {
      if (!this.scene.cache.audio.exists(key)) return;
      const detune = (Math.random() * 2 - 1) * detuneCents;
      const v = Phaser.Math.Clamp(volume + (Math.random() * 2 - 1) * volumeJitter, 0, 1);
      if (this.audioManager) {
        this.audioManager.playSfx(key, { volume: v, detune });
      } else {
        this.scene.sound.play(key, { volume: v, detune });
      }
    } catch { /* silent */ }
  }

  private createEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | null {
    try {
      const textureExists = this.scene.textures?.exists("_juice_particle") ?? false;
      if (!textureExists) {
        const gfx = this.scene.make.graphics({ x: 0, y: 0 });
        gfx.fillStyle(0xffffff, 1);
        gfx.fillCircle(4, 4, 4);
        gfx.generateTexture("_juice_particle", 8, 8);
        gfx.destroy();
      }
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
    ev.on(GameEvents.TerritoryCaptured, this.onTerritoryCaptured, this);
    ev.on(GameEvents.TrailCut, this.onTrailCut, this);
    ev.on(GameEvents.PlayerDied, this.onPlayerDied, this);
    ev.on(GameEvents.UpgradeApplied, this.onUpgradeApplied, this);
    ev.on(GameEvents.UpgradeOffer, this.onUpgradeOffer, this);
    ev.on(GameEvents.GhostSpawned, this.onGhostSpawned, this);
    ev.on(GameEvents.TrailClosed, this.onTrailClosed, this);
    ev.on(GameEvents.GhostExpired, this.onGhostExpired, this);
    ev.on(GameEvents.CoinEarned, this.onCoinEarned, this);
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

    this.rgbClearHandle?.remove(false);
    this.rgbClearHandle = this.scene.time.delayedCall(durationMs, () => {
      this.rgbClearHandle = null;
      this.clearRgbLayers();
    });
  }

  private clearRgbLayers(): void {
    this.rgbClearHandle?.remove(false);
    this.rgbClearHandle = null;
    for (const r of this.rgbLayers) r.destroy();
    this.rgbLayers = [];
  }

  destroy(): void {
    const ev = this.scene.events;
    ev.off(GameEvents.TerritoryCaptured, this.onTerritoryCaptured, this);
    ev.off(GameEvents.TrailCut, this.onTrailCut, this);
    ev.off(GameEvents.PlayerDied, this.onPlayerDied, this);
    ev.off(GameEvents.UpgradeApplied, this.onUpgradeApplied, this);
    ev.off(GameEvents.UpgradeOffer, this.onUpgradeOffer, this);
    ev.off(GameEvents.GhostSpawned, this.onGhostSpawned, this);
    ev.off(GameEvents.TrailClosed, this.onTrailClosed, this);
    ev.off(GameEvents.GhostExpired, this.onGhostExpired, this);
    ev.off(GameEvents.CoinEarned, this.onCoinEarned, this);
    this.clearRgbLayers();
    this.ambientFadeHandle?.remove(false);
    if (this.slowMoHandle !== null) {
      clearTimeout(this.slowMoHandle);
      this.slowMoHandle = null;
      this.scene.time.timeScale = 1;
      this.scene.tweens.timeScale = 1;
    }
    this.emitter?.destroy();
    this.emitter = null;
    this.ambientEmitter?.destroy();
    this.ambientEmitter = null;
  }
}
