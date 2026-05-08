// Audio key registry. Files attached by sound agent later.

export const AUDIO = {
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
  },
  defaultSfxVolume: 1.0,
} as const;

export type AudioConfig = typeof AUDIO;
