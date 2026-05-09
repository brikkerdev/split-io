import Phaser from "phaser";
import { AUDIO } from "@config/audio";

interface AudioState {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

const SFX_THROTTLE_MS = 50;

export class AudioManager {
  private state: AudioState = { musicVolume: 0.6, sfxVolume: 1, muted: false };
  private currentMusic: Phaser.Sound.BaseSound | null = null;
  private lastPlayMs = new Map<string, number>();

  // ---- Tension layer WebAudio nodes ----
  private tensionOsc: OscillatorNode | null = null;
  private tensionGain: GainNode | null = null;
  private tensionLfo: OscillatorNode | null = null;
  private tensionLfoGain: GainNode | null = null;
  private tensionActive = false;

  // ---- Coin throttle ----
  private lastCoinMs = 0;

  constructor(private scene: Phaser.Scene) {}

  playMusic(key: string, loop = true): void {
    if (this.currentMusic?.key === key && this.currentMusic.isPlaying) return;
    this.currentMusic?.stop();
    const music = this.scene.sound.add(key, { loop, volume: this.state.musicVolume });
    music.play();
    this.currentMusic = music;
  }

  stopMusic(): void {
    this.currentMusic?.stop();
    this.currentMusic = null;
  }

  playSfx(key: string, opts?: Phaser.Types.Sound.SoundConfig): void {
    if (this.state.muted) return;
    const now = Date.now();
    const last = this.lastPlayMs.get(key) ?? 0;
    if (now - last < SFX_THROTTLE_MS) return;
    this.lastPlayMs.set(key, now);
    this.scene.sound.play(key, { volume: this.state.sfxVolume, ...opts });
  }

  setMusicVolume(v: number): void {
    this.state.musicVolume = Phaser.Math.Clamp(v, 0, 1);
    if (this.currentMusic && "setVolume" in this.currentMusic) {
      (this.currentMusic as Phaser.Sound.WebAudioSound).setVolume(this.state.musicVolume);
    }
  }

  setSfxVolume(v: number): void {
    this.state.sfxVolume = Phaser.Math.Clamp(v, 0, 1);
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    this.scene.sound.mute = muted;
    if (muted) this.stopTensionLayer();
  }

  // ---- Tension layer (task 4) ----

  setTensionLayer(active: boolean): void {
    if (active === this.tensionActive) return;
    this.tensionActive = active;
    if (active) {
      this.startTensionLayer();
    } else {
      this.stopTensionLayer();
    }
  }

  private getAudioCtx(): AudioContext | null {
    const sm = this.scene.sound as Phaser.Sound.BaseSoundManager & { context?: AudioContext };
    return sm.context ?? null;
  }

  private startTensionLayer(): void {
    if (this.state.muted) return;
    const ctx = this.getAudioCtx();
    if (!ctx) return;
    if (ctx.state !== "running") return;

    // Already running — skip duplicate start.
    if (this.tensionOsc !== null) return;

    const cfg = AUDIO.synth.tension;
    const maxGain = cfg.maxGain * this.state.sfxVolume;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(cfg.lfoRateHz, ctx.currentTime);

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(cfg.lfoDepth, ctx.currentTime);
    lfo.connect(lfoGain);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(cfg.freqHz, ctx.currentTime);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(maxGain, ctx.currentTime + cfg.fadeInMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    lfo.start();
    osc.start();

    this.tensionOsc = osc;
    this.tensionGain = gain;
    this.tensionLfo = lfo;
    this.tensionLfoGain = lfoGain;
  }

  private stopTensionLayer(): void {
    const ctx = this.getAudioCtx();
    const gain = this.tensionGain;
    const osc = this.tensionOsc;
    const lfo = this.tensionLfo;
    if (!ctx || !gain || !osc) {
      this.tensionOsc = null;
      this.tensionGain = null;
      this.tensionLfo = null;
      this.tensionLfoGain = null;
      return;
    }
    const cfg = AUDIO.synth.tension;
    const fadeOutSec = cfg.fadeOutMs / 1000;
    const stopAt = ctx.currentTime + fadeOutSec + 0.05;
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + fadeOutSec);
    osc.stop(stopAt);
    lfo?.stop(stopAt);
    this.tensionOsc = null;
    this.tensionGain = null;
    this.tensionLfo = null;
    this.tensionLfoGain = null;
  }

  // ---- Coin ping (task 5) ----

  playCoinPing(): void {
    if (this.state.muted) return;
    const now = Date.now();
    const cfg = AUDIO.synth.coin;
    if (now - this.lastCoinMs < cfg.throttleMs) return;
    this.lastCoinMs = now;

    const ctx = this.getAudioCtx();
    if (!ctx || ctx.state !== "running") return;

    const jitter = 1 + (Math.random() * 2 - 1) * cfg.pitchJitter;
    const baseFreq = cfg.freqHzMin + Math.random() * (cfg.freqHzMax - cfg.freqHzMin);
    const freq = baseFreq * jitter;
    const durSec = cfg.durationMs / 1000;
    const peakGain = cfg.gain * this.state.sfxVolume;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durSec + 0.01);
  }

  // ---- Paper-rip noise burst (task 12) ----

  playPaperRip(): void {
    if (this.state.muted) return;
    const ctx = this.getAudioCtx();
    if (!ctx || ctx.state !== "running") return;

    const cfg = AUDIO.synth.paperRip;
    const durSec = cfg.durationMs / 1000;
    const peakGain = cfg.gain * this.state.sfxVolume;

    const bufLen = Math.ceil(ctx.sampleRate * durSec);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(cfg.bandpassFreqHz, ctx.currentTime);
    bp.Q.setValueAtTime(cfg.bandpassQ, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durSec);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + durSec + 0.01);
  }

  // ---- Ghost puff (task 13) ----

  playGhostPuff(): void {
    if (this.state.muted) return;
    const ctx = this.getAudioCtx();
    if (!ctx || ctx.state !== "running") return;

    const cfg = AUDIO.synth.ghostPuff;
    const durSec = cfg.durationMs / 1000;
    const peakGain = cfg.gain * this.state.sfxVolume;

    const bufLen = Math.ceil(ctx.sampleRate * durSec);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cfg.lowpassFreqHz, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durSec);

    src.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + durSec + 0.01);
  }

  // ---- Split-ready tick (task 15) ----

  playSplitReadyTick(): void {
    if (this.state.muted) return;
    const ctx = this.getAudioCtx();
    if (!ctx || ctx.state !== "running") return;

    const cfg = AUDIO.synth.splitReadyTick;
    const durSec = cfg.durationMs / 1000;
    const peakGain = cfg.gain * this.state.sfxVolume;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(cfg.freqHz, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durSec + 0.01);
  }
}
