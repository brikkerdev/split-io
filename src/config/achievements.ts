// 8 achievements. GDD §3.

export type AchievementId =
  | "first_5pct"
  | "survive_round"
  | "kill_with_ghost"
  | "top1_streak3"
  | "capture_50pct"
  | "capture_100pct"
  | "ten_kills_round"
  | "all_skins";

export interface AchievementDef {
  id: AchievementId;
  nameKey: string;
  target: number;
  rewardCoins: number;
}

export const ACHIEVEMENTS = {
  list: [
    { id: "first_5pct",      nameKey: "ach.first_5pct",      target: 1,  rewardCoins: 50  },
    { id: "survive_round",   nameKey: "ach.survive_round",   target: 1,  rewardCoins: 100 },
    { id: "kill_with_ghost", nameKey: "ach.kill_with_ghost", target: 1,  rewardCoins: 100 },
    { id: "top1_streak3",    nameKey: "ach.top1_streak3",    target: 3,  rewardCoins: 300 },
    { id: "capture_50pct",   nameKey: "ach.capture_50pct",   target: 1,  rewardCoins: 150 },
    { id: "capture_100pct",  nameKey: "ach.capture_100pct",  target: 1,  rewardCoins: 500 },
    { id: "ten_kills_round", nameKey: "ach.ten_kills_round", target: 10, rewardCoins: 200 },
    { id: "all_skins",       nameKey: "ach.all_skins",       target: 12, rewardCoins: 1000 },
  ] satisfies AchievementDef[],
} as const;

export type AchievementsConfig = typeof ACHIEVEMENTS;
