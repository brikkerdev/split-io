# Split.io — MVP Plan (code only)

Live document. Sound and visual assets handled by separate agents — **do not** touch `assets/audio/`, `src/ui/styles/`, palette colours, or icon swaps.

## Project state snapshot

Stack: Phaser 3, TS strict, Vite, Bun. Build size ~5.5 MB (gzip ~1.2 MB).

Done: Grid, Trail, Territory (flood-fill), Ghost (prefly→homing→fallback), BotAI (3 profiles), Score, Progression, Input (joystick + mouse), AdSystem, LeaderboardSystem (real Yandex SDK + localStorage fallback), SaveManager, Locale, JuiceSystem, full scene chain (Boot → Preload → Menu → Game → GameOver), DOM UI overlay (HUD, Menu, GameOver, UpgradeModal), pastel palette, Phosphor icons, circular map with 3D border, daily reward, ru/en/tr locales, 172 tests passing, `tsc --noEmit` clean.

Known broken / partial:

- `BotAI.claimStartTerritory` writes to grid but does not call `TerritorySystem.claimCells` → bots have 0 % in stats.
- `pause:toggle` event is emitted on upgrade-offer but nobody subscribes → game keeps running while user picks an upgrade.
- Skins, Achievements, Settings, Leaderboard, Daily-reward modals are stubs that show "Coming soon".
- `Hero.spawn/update/die` are empty methods (logic lives in `GameScene.moveHero`).
- Continue rewarded ad in GameOver does a full scene restart instead of in-round respawn with 70 % territory.

Missing assets (handled by separate agents): `logo_splitio.png`, `icon_512.png`, all SFX, music. Do **not** generate these.

---

## Task list (priority order)

Tasks are independent unless noted. Each task lists files, current state, acceptance.

### T1. Bot start territory bug

Priority: P0 (blocks correct stats / leaderboard).

Files:
- `src/systems/BotAI.ts` — `claimStartTerritory()` ~L486
- `src/systems/TerritorySystem.ts` — uses `claimCells(owner, packed)`

Current: method writes via `this.grid.setOwner` and discards `packed`. No `TerritoryUpdate` / `TerritoryCaptured` ever fires for bots, so leaderboard percent stays 0.

Do: replace direct grid writes with `this.territory?.claimCells(bot.id, packed)`. Drop the `void packed` line. Verify bot percent now updates by playing 30 s and inspecting leaderboard HUD.

Acceptance: bot rows in HUD leaderboard show `>0 %`; tests still 172/172 green.

### T2. Pause system

Priority: P0 (Yandex requirement, also fixes upgrade-offer abuse).

Files:
- `src/scenes/GameScene.ts` — `update()` and `bindEvents()`
- `src/ui/dom/DomUI.ts` — already emits `pause:toggle` on upgrade modal show/hide
- `src/main.ts` — already pauses Phaser loop on `visibilitychange`
- New: `src/ui/dom/DomPause.ts` (pause overlay, lazy-mounted)
- New: HUD pause button (small icon top-right of HUD) in `src/ui/dom/DomHUD.ts`

Behaviour:
1. Subscribe to `pause:toggle` (game.events) inside `GameScene`. When paused: set `roundActive = false`, `scene.pause()` for systems that need it, mute SFX. When resumed: reverse.
2. HUD pause button toggles. Modal overlay says "Paused — Resume / Menu".
3. Already paused while upgrade modal open (handled by existing `pause:toggle` emit).
4. `visibilitychange` should also auto-pause (re-use the same toggle).

Acceptance: clicking pause stops hero/bots/ghost movement and timers; resume restores cleanly; opening upgrade card pauses too; tabbing away pauses; tests green.

### T3. In-round respawn for rewarded continue

Priority: P0 (GDD §5).

Files:
- `src/scenes/GameOverScene.ts` — `handleContinue()` currently does `scene.start("Game")`
- `src/scenes/GameScene.ts` — needs a `respawnHero()` method
- `src/systems/AdSystem.ts` — already has hourly limit / cooldown
- `src/types/save.ts` — `continueHourlyCount` already tracked

Behaviour:
1. From GameOver: `onContinue` calls `AdSystem.showRewarded("continue")`. On success, do NOT start new Game scene — instead launch existing Game scene back into round mode (reverse `endRound`).
2. New API in GameScene: `applyContinue()` — set `hero.alive = true`, snap hero to safe point inside own territory, clear hero trail, drop territory ownership down to 70 % (proportionally release outermost cells), unset `roundEndEmitted`, `roundActive = true`, restart `gameplayStart`.
3. To find safe point: pick own cell furthest from any enemy unit / trail.
4. Limit is `1 continue per round` AND hourly bucket from `AdSystem`.

Acceptance: dying then clicking Continue brings player back inside their own zone alive with reduced territory; round timer / score continues; only one continue allowed per round.

### T4. Skins picker + apply

Priority: P1.

Files:
- `src/config/skins.ts` — 12 skins already defined
- `src/types/save.ts` — already has `selectedSkinId`, add `unlockedSkinIds: string[]` if missing
- New: `src/ui/dom/DomSkinsModal.ts`
- `src/ui/dom/DomMenu.ts` — wire skin button (currently `openStub`)
- `src/scenes/GameScene.ts` — apply selected skin colour to hero render
- `src/config/palette.ts` — read selected skin colour from save instead of hard-coded `PALETTE.hero`

Behaviour:
1. Modal lists all skins as cards (locked vs owned). Locked ones show price (coins from save). Click locked → if enough coins, unlock + select. Click owned → select. Selection persists in save.
2. GameScene reads `saves.get<SaveV1>().selectedSkinId`, looks up colour in `SKINS`, uses for hero fill / trail / territory tint everywhere `PALETTE.hero` is referenced.

Acceptance: open Skins from menu, buy/select a skin, start round → hero uses chosen colour. Coins decrement on purchase. Selection persists across reload.

### T5. Achievements tracking

Priority: P1.

Files:
- `src/config/achievements.ts` — 8 achievements already defined
- New: `src/systems/AchievementSystem.ts`
- `src/types/save.ts` — already has `achievements: Record<string, boolean>` (verify)
- New: `src/ui/dom/DomAchievementsModal.ts`
- `src/ui/dom/DomMenu.ts` — wire achievements button
- `src/scenes/GameScene.ts` — instantiate AchievementSystem with hero id
- `src/ui/dom/DomGameOver.ts` — show toast for newly unlocked

Behaviour:
1. AchievementSystem subscribes to events: `TerritoryUpdate`, `TrailCut`, `RoundEnd`, `GhostDestroyed`. Tracks per-round and life-time stats. On unlock condition met: write to save + emit `achievement:unlocked` (new event).
2. Wire all 8 achievements per `src/config/achievements.ts` definitions.
3. Modal shows full list with locked / unlocked state and reward if any.

Acceptance: relevant gameplay action unlocks corresponding achievement once; persists; modal renders all 8 with correct state; tests added for unlock logic.

### T6. Settings modal

Priority: P1.

Files:
- New: `src/ui/dom/DomSettingsModal.ts`
- `src/types/save.ts` — already has `settings.musicVolume`, `settings.sfxVolume`, `settings.controlScheme`, `settings.lang`
- `src/ui/dom/DomMenu.ts` — wire settings button
- `src/systems/Locale.ts` — add `setLang(lang)` that re-applies translations and emits `lang:changed`
- DOM listeners on `lang:changed` should re-render menu

Behaviour:
1. Sliders / toggles for: music volume, sfx volume, language (ru/en/tr), control scheme (swipe / joystick).
2. Volume changes: directly write to save and update `game.sound.volume` for music/sfx categories.
3. Lang change: re-init Locale, re-render visible HTML via existing `applyI18n` plus `data-i18n` re-traversal.
4. Control scheme change: write to save, takes effect on next round (or live if simple).

Acceptance: every setting persists across reload; lang switch updates all UI text without reload; tests cover SaveManager round-trip.

### T7. Leaderboard modal

Priority: P2.

Files:
- New: `src/ui/dom/DomLeaderboardModal.ts`
- `src/systems/LeaderboardSystem.ts` — `getTop(10)` and `getPlayerRank()` already implemented
- `src/ui/dom/DomMenu.ts` — wire leaderboard button

Behaviour:
1. Async load top 10 from `LeaderboardSystem.getTop(10)`. Show rank, name, score.
2. Show player's own rank below (if outside top 10).
3. Loading state spinner during fetch.

Acceptance: opens, fetches, renders. Falls back to localStorage mock when Yandex SDK absent.

### T8. Daily reward integration

Priority: P2.

Files:
- `src/ui/dom/DomMenu.ts` — daily reward button + modal exist as stub
- `src/types/save.ts` — needs `lastDailyClaimMs: number` if missing
- `src/systems/DailyRewardSystem.ts` (new, lightweight)

Behaviour:
1. On menu mount: compute time-since-last-claim. If ≥ 24 h → enable claim button with badge.
2. Click → award `DAILY_COINS = 50` to save, set `lastDailyClaimMs = now`, refresh menu state.
3. Otherwise show countdown until next claim.

Acceptance: reward gives coins once per 24h; tests cover the timer logic.

### T9. Hero entity refactor

Priority: P3 (cleanup, non-blocking).

Files:
- `src/entities/Hero.ts` — `spawn/update/die` are empty; logic lives in `GameScene.moveHero`
- `src/scenes/GameScene.ts`

Do: move per-frame movement, trail handling, posHistory, velocity update from `GameScene.moveHero` into `Hero.update(dt, deps)`. Keep `GameScene` as orchestrator. Don't change behaviour.

Acceptance: tests still green; visual gameplay identical; GameScene smaller.

### T10. Final ship pass

Priority: P0 last.

Files:
- runs `/ship` slash command which delegates to `yandex-integrator` + `promo` agents

Pre-conditions: T1, T2, T3 done; sound assets in place (other agent); icons + logo generated (other agent).

Do: run validation, fix any moderation issues, package build for upload.

---

## Working agreements

- TS strict, no `any`, no `@ts-ignore`. Magic numbers go in `src/config/`.
- Singletons only `saves`, `locale`, `yandex` (and `DomUI` for legacy reasons).
- Cross-scene events: `game.events`. Intra-scene: `scene.events`.
- Tests: every system gets at least smoke tests; total must stay green.
- Run `npx tsc --noEmit` and `npx vitest run` before declaring a task done.
- Run `npx vite build` on T1 / T2 / T3 / T10 to keep build green.
- Do not add npm dependencies without checking with the user. Phaser, Phosphor, Vite, Vitest are already in.
- Do not create new docs unless asked.
- Localise every new UI string via `locale.t(key)` and add ru/en/tr entries in `src/locales/`.
- When touching `src/scenes/GameScene.ts`, reset all relevant per-run state at the top of `create()` — the class instance is reused across restarts.

## Out of scope

- Sound (other agent)
- Visual restyling, palette, icon assets (other agent)
- Yandex moderation copy / promo screenshots (other agent / `/ship`)
- Real multiplayer
- IAP, third-party login
- 3D, physics engine
- Custom maps, multiple modes
