// Typed event keys for cross-scene `game.events`.

export const GlobalEvents = {
  LangChanged: "lang:changed",
  PauseToggle: "pause:toggle",
  AppVisible: "app:visible",
} as const;

export type GlobalEventKey = (typeof GlobalEvents)[keyof typeof GlobalEvents];
