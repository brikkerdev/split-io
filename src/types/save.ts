import type { Lang } from "@config/game";
import type { SaveData } from "@systems/SaveManager";

export interface SaveV1 extends SaveData {
  version: 1;
  coins: number;
  bestScore: number;
  selectedSkin: string;
  unlockedSkins: string[];
  achievements: Record<string, number>;
  dailyClaimedAt: number;
  roundsPlayed: number;
  continuesUsedThisRound: number;
  settings: {
    musicVolume: number;
    sfxVolume: number;
    controlScheme: "swipe" | "joystick";
    lang: Lang | null;
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
  roundsPlayed: 0,
  continuesUsedThisRound: 0,
  settings: {
    musicVolume: 0.6,
    sfxVolume: 1.0,
    controlScheme: "swipe",
    lang: null,
  },
};
