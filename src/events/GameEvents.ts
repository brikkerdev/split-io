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

  CoinEarned: "coin:earned",
  CoinTotalChanged: "coin:total",

  /** Emitted when a new cycle starts after upgrade pick. Payload: { cycle: number } */
  CycleStart: "cycle:start",

  /** Emitted when player wins (pool exhausted). No payload. */
  Victory: "victory",

  /** Emitted just before GameOver modal is shown (post-mortem zoom plays first). */
  PreGameOver: "round:preGameOver",

  /** Emitted on game.events when the player changes the control scheme in settings. */
  ControlSchemeChanged: "settings:controlScheme",

  /** Emitted on game.events when the player selects a skin in the skins modal. */
  SkinChanged: "settings:skin",
} as const;

export type GameEventKey = (typeof GameEvents)[keyof typeof GameEvents];
