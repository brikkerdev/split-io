// Typed event keys for `scene.events` on GameScene.
// Use as: scene.events.emit(GameEvents.ScoreUpdate, value).

export const GameEvents = {
  ScoreUpdate: "score:update",
  TerritoryUpdate: "territory:update",
  TerritoryCaptured: "territory:captured",
  LeaderboardUpdate: "leaderboard:update",

  SplitRequest: "split:request",
  SplitCooldown: "split:cooldown",

  GhostSpawned: "ghost:spawned",
  GhostPhaseChanged: "ghost:phaseChanged",
  GhostDestroyed: "ghost:destroyed",
  GhostExpired: "ghost:expired",

  TrailCellAdded: "trail:cellAdded",
  TrailClosed: "trail:closed",
  TrailCut: "trail:cut",
  PlayerDied: "player:died",

  RoundTick: "round:tick",
  RoundEnd: "round:end",
  RoundContinue: "round:continue",

  UpgradeOffer: "upgrade:offer",
  UpgradeApplied: "upgrade:applied",

  DailyClaimed: "daily:claimed",
  AchievementUnlocked: "achievement:unlocked",
} as const;

export type GameEventKey = (typeof GameEvents)[keyof typeof GameEvents];
