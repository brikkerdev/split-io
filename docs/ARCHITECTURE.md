# Architecture — Split.io

Neon paper-io. Logical grid 128x128, smooth sub-cell motion. Hero + spawnable Ghost form pincers; closing trail loops triggers flood-fill capture. 3-minute round vs 15-25 bots.

## Scene flow

```
Boot → Preload → Menu → Game (+ UI overlay) → GameOver → (Menu | Game)
```

- **Boot**: minimal logo, kicks Preload.
- **Preload**: loads atlases, audio, locales, calls `yandex.gameReady()`.
- **Menu**: title, Play, skin select, achievements, daily reward modal.
- **Game**: arena, hero, ghost, bots, territory, trails, simulation. Owns all gameplay systems.
- **UI** (parallel overlay): timer, score, territory percent, split cooldown ring, upgrade cards, mini-leaderboard.
- **GameOver**: round summary breakdown (territory + speed + kills − penalty), Continue (rewarded), Retry, Menu. Pushes leaderboard score, queues interstitial.

Inter-scene comms only via `scene.events` / `game.events`. No cross-scene refs.

## Systems

| System | Responsibility | Owns | Reads |
|---|---|---|---|
| GridSystem | logical 128x128 cell grid; cell ownership map; world↔cell math | Uint16Array map | grid config |
| TerritorySystem | flood-fill capture on loop close, polygon mesh per owner, area calc | per-owner cell sets, merged geometry | grid, palette |
| TrailSystem | active trail polylines for hero / ghost / bots; segment store; intersection queries | per-owner trail segments | grid |
| GhostSystem | ghost lifecycle: prefly 3s → homing 7s max → fallback to home; in-home timer 0.5s | active Ghost entity | ghost config, hero ref |
| BotAI | spawn 15-25 bots, 3 behavior profiles, scaling aggression by player size | bot entities, profile pool | balance, palette |
| InputSystem | mouse heading on desktop, swipe heading + tap-Split on mobile, optional joystick | input state | settings |
| ScoreSystem | live score, territory %, kill counter, end-of-round breakdown | score state | score config |
| ProgressionSystem | per-10% upgrade picker (2 cards, 4s auto), apply upgrade modifiers | active modifiers | balance |
| JuiceSystem | screen-shake, slow-mo, bloom pulse, particles, RGB-split death | particle emitters | palette |
| AdSystem | interstitial gate (every 2nd round, 60s cooldown, skip first), rewarded continue, x2 currency | counters | ads config, yandex |
| SaveSystem (singleton `saves`) | typed save load/patch/flush, version migration | SaveV1 cache | save schema |
| LocaleSystem (singleton `locale`) | ru/en/tr dict lookup, lang from yandex env | dicts | game config |
| LeaderboardSystem | post composite score to Yandex leaderboard `score_round` | last submitted score | yandex |
| AudioSystem | music + sfx volume, ducking, mute on hidden | scene.sound refs | audio keys |

`SaveSystem`, `LocaleSystem`, `yandex` are the only singletons. Everything else is per-scene, DI via constructor.

## Entities

- **Player** (`Hero`): position, heading, speed, alive flag, modifiers, color, skin id.
- **Ghost**: position, heading, age, phase (`prefly` | `homing` | `fallback`), in-home timer, parent ref.
- **Bot**: extends a shared `Unit` with profile (`aggressor` | `tourist` | `accumulator`), name, color.
- **Trail**: array of cell coords + smoothed polyline points, owner id.
- **Territory**: per-owner cell set + cached polygon contour for render.

Shared `Unit` interface backs Player/Bot to keep Trail/Territory generic over owner id.

## Data flow

```
Input ──heading──▶ Hero
                    │
                    ├─tick──▶ TrailSystem (append cell)
                    │
            Split! ─┴──▶ GhostSystem.spawn(hero.pos, hero.heading)

GhostSystem.tick ──▶ Ghost ──▶ TrailSystem
TrailSystem.onIntersect(a,b) ──▶ TerritorySystem.captureLoop(owner, polygon)
TerritorySystem.onCapture(owner, deltaCells) ──▶ ScoreSystem ──▶ events.score:update
                                                            └──▶ events.territory:update
ScoreSystem ──every10%──▶ events.upgrade:offer ──▶ ProgressionSystem (UIScene)

BotAI.tick ──▶ each bot heading + Split decisions ──▶ same TrailSystem / GhostSystem path

Hero/Ghost dies ──▶ events.player:died ──▶ JuiceSystem + GameScene.endRound
GameScene.endRound ──▶ scene.start("GameOver", { breakdown })
GameOver retry ──▶ AdSystem.maybeInterstitial ──▶ scene.start("Game")
```

## Events

All on `scene.events` of GameScene unless noted. Constants in `src/events/`.

| Event | Payload | From | To |
|---|---|---|---|
| `score:update` | `number` | ScoreSystem | UIScene |
| `territory:update` | `{ owner: number; percent: number }` | TerritorySystem | UIScene, ScoreSystem |
| `territory:captured` | `{ owner: number; cells: number; bbox: Rect }` | TerritorySystem | JuiceSystem, ScoreSystem |
| `split:request` | `void` | InputSystem | GhostSystem |
| `split:cooldown` | `{ remaining: number; total: number }` | GhostSystem | UIScene |
| `ghost:spawned` | `{ pos: Vec2; heading: number }` | GhostSystem | JuiceSystem, AudioSystem |
| `ghost:expired` | `{ reason: "captured" \| "killed" \| "fallback" }` | GhostSystem | UIScene |
| `trail:cut` | `{ victim: number; killer: number }` | TrailSystem | ScoreSystem, JuiceSystem |
| `player:died` | `{ cause: string }` | GameScene | UIScene, GameOver |
| `round:tick` | `{ remainingMs: number }` | GameScene | UIScene |
| `round:end` | `RoundBreakdown` | GameScene | GameOver |
| `upgrade:offer` | `{ choices: UpgradeId[] }` | ProgressionSystem | UIScene |
| `upgrade:applied` | `{ id: UpgradeId }` | ProgressionSystem | Hero, GhostSystem |
| `daily:claimed` | `{ amount: number }` | MenuScene | SaveSystem |

Cross-scene (`game.events`):

| Event | Payload | From | To |
|---|---|---|---|
| `lang:changed` | `Lang` | Settings | all scenes |
| `pause:toggle` | `boolean` | UI | Game |

## Save schema

```ts
interface SaveV1 {
  version: 1;
  coins: number;
  bestScore: number;
  selectedSkin: string;
  unlockedSkins: string[];
  achievements: Record<string, number>; // id -> unlockedAt ms
  dailyClaimedAt: number; // ms epoch, 0 if never
  roundsPlayed: number;
  settings: {
    musicVolume: number;
    sfxVolume: number;
    controlScheme: "swipe" | "joystick";
    lang: Lang | null; // null => auto
  };
}
```

## Folder layout

```
src/
  main.ts
  config/        balance, ghost, score, ads, grid, palette, skins, upgrades, audio, game
  events/        typed event keys + payload types
  types/         domain interfaces (Vec2, Rect, Unit, Trail, RoundBreakdown, ...)
  scenes/        Boot, Preload, Menu, Game, UI, GameOver
  systems/       Grid, Territory, Trail, Ghost, BotAI, Score, Progression,
                 Input, Juice, Ad, Leaderboard, Save (existing), Locale (existing),
                 Economy (existing), Audio (existing)
  entities/      Unit, Hero, Ghost, Bot
  sdk/           yandex (existing)
```

## Balance configs

- `src/config/grid.ts` — cell counts, cell size px.
- `src/config/balance.ts` — round seconds, hero speed, bot counts, in-home timer.
- `src/config/ghost.ts` — prefly seconds, max lifetime, homing radius, cooldown, first-round cooldown.
- `src/config/score.ts` — territoryWeight, secondWeight, killBonus, deathPenalty.
- `src/config/ads.ts` — interstitial cadence, continue limits.
- `src/config/palette.ts` — neon hex per owner band, glow intensities.
- `src/config/upgrades.ts` — upgrade pool, magnitudes.
- `src/config/skins.ts` — 12 cosmetic entries.
- `src/config/audio.ts` — sfx + music keys.

No magic numbers in systems/scenes. All numeric tuning lives here.

## Performance budget

- 60 FPS on mid mobile, fallback 30.
- Glow only on hero, ghost, nearest 5 bots.
- Territory polygons merged into 1 geometry per owner.
- Flood-fill: scanline O(N), invoked only on loop close (event), not per frame.
- Trail point pool, capped by max-lifetime length.
- < 100 particles concurrent.
