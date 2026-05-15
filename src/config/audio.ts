// Audio key registry. Files attached by sound agent later.

export const AUDIO = {
  /** WebAudio synthesised SFX params — no asset files needed. */
  synth: {
    /** Coin "ting": high sine/triangle envelope. */
    coin: {
      freqHzMin: 880,
      freqHzMax: 1320,
      pitchJitter: 0.05,
      gain: 0.08,
      durationMs: 60,
      throttleMs: 125,
    },
    /** Paper-rip noise burst on hero kill. */
    paperRip: {
      gain: 0.25,
      durationMs: 80,
      bandpassFreqHz: 3000,
      bandpassQ: 1.2,
    },
    /** Ghost puff SFX. */
    ghostPuff: {
      gain: 0.12,
      durationMs: 120,
      lowpassFreqHz: 800,
    },
    /** Split-ready soft tick. */
    splitReadyTick: {
      freqHz: 1760,
      gain: 0.1,
      durationMs: 40,
    },
  },
  sfx: {
    split: "sfx_split",
    capture: "sfx_capture",
    death: "sfx_death",
    warning: "sfx_warning",
    upgrade: "sfx_upgrade",
    uiClick: "sfx_ui_click",
    uiHover: "sfx_ui_hover",
    countdown: "sfx_countdown",
    matchStart: "sfx_match_start",
    victory: "sfx_victory",
    coin: "sfx_coin",
    achievement: "sfx_achievement",
  },
  defaultSfxVolume: 1.0,
} as const;

export type AudioConfig = typeof AUDIO;
