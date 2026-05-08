export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const SUPPORTED_LANGS = ["ru", "en", "tr"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = "ru";

export const SAVE_KEY = "save";
export const SAVE_VERSION = 1;

export const ADS_INTERSTITIAL_COOLDOWN_MS = 60_000;
