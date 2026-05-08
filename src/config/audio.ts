// Audio key registry. Files attached by sound agent later.

export const AUDIO = {
  music: {
    menu: "mus_menu",
    game: "mus_game",
    gameoverStinger: "mus_stinger",
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
  },
  defaultMusicVolume: 0.6,
  defaultSfxVolume: 1.0,
} as const;

export type AudioConfig = typeof AUDIO;
