import type { Lang } from "@config/game";
import type { SaveData } from "@systems/SaveManager";

export interface SaveV1 extends SaveData {
  version: 1;
  coins: number;
  bestScore: number;
  selectedSkin: string;
  unlockedSkins: string[];
  achievements: Record<string, number>;
  /** Timestamp (ms) of last successful daily-reward claim. */
  dailyClaimedAt: number;
  /** 0-based index into the 90-day daily-reward schedule for the NEXT claim. */
  dailyDayIndex: number;
  /** Active "fire" streak — consecutive claims within 48h grace window. */
  dailyStreak: number;
  /** All-time best streak. Used for cosmetic celebration. */
  dailyStreakBest: number;
  roundsPlayed: number;
  continuesUsedThisRound: number;
  /** Player consented to publishing scores to the Yandex leaderboard. */
  lbConsent: boolean;
  /** Score awaiting consent + auth before being submitted. 0 = none pending. */
  pendingLbScore: number;
  /** Whether the shortcut-to-homescreen prompt has been shown once. */
  shortcutPromptShown: boolean;
  /** Whether the first-round move/shoot tutorial has been completed once. */
  tutorialShown: boolean;
  settings: {
    musicVolume: number;
    sfxVolume: number;
    controlScheme: "swipe" | "joystick";
    lang: Lang | null;
    /** HUD/UI scale multiplier (e.g. 0.85 small, 1.0 normal, 1.15 large). */
    uiScale: number;
  };
}

export const DEFAULT_SAVE: SaveV1 = {
  version: 1,
  coins: 0,
  bestScore: 0,
  selectedSkin: "neon_cyan",
  unlockedSkins: ["neon_cyan"],
  achievements: {},
  dailyClaimedAt: 0,
  dailyDayIndex: 0,
  dailyStreak: 0,
  dailyStreakBest: 0,
  roundsPlayed: 0,
  continuesUsedThisRound: 0,
  lbConsent: false,
  pendingLbScore: 0,
  shortcutPromptShown: false,
  tutorialShown: false,
  settings: {
    musicVolume: 0.6,
    sfxVolume: 1.0,
    controlScheme: "swipe",
    lang: null,
    uiScale: 1.0,
  },
};
