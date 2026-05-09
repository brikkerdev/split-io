# Yandex Games — Live Pre-Ship Checklist

Source-of-truth pages fetched 2026-05-09:
- requirements: https://yandex.ru/dev/games/doc/ru/concepts/requirements
- sdk-about:    https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
- sdk-adv:      https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
- quality-tips: 404 (page moved/removed); covered via requirements §6
- localization: 404 (page moved/removed); covered via requirements §2.10, §2.14

## Build & size
- [x] 1.21 Build ≤ 100 MB uncompressed — measured `dist/` = **15.91 MB** (validator output).
- [x] 1.22 `index.html` at archive root — `dist/index.html` exists.
- [x] File names ASCII-only, no spaces — `scripts/validate-yandex.ts` regex `/[а-яА-ЯёЁ\s]/` passed.
- [x] Validator green — `npx tsx scripts/validate-yandex.ts` → "passed (0 warnings)".

## SDK integration
- [x] 1.1 SDK embedded — `index.html:259` `<script src="https://yandex.ru/games/sdk/v2"></script>`.
- [x] SDK init before use — `src/main.ts:23` `await yandex.init()` before `new Phaser.Game`.
- [x] 1.19.2 `LoadingAPI.ready()` fires when playable — `src/sdk/yandex.ts:42-46`, called from `src/ui/dom/DomUI.ts:214` after preload.
- [x] 1.19.3 `GameplayAPI.start/stop` wrap active gameplay — `src/scenes/game/PhaseController.ts:94,106,157,193,210,222,256,267,305` + `src/scenes/GameScene.ts:419`.
- [x] 1.4 No third-party payments — no payments code in repo.
- [x] 1.5 Ads only via SDK — `src/sdk/yandex.ts:79-148` uses `ysdk.adv.*` exclusively.
- [x] 1.2 / 1.2.1 Auth on user action only — `requestAuth()` at `src/sdk/yandex.ts:206`, called from leaderboard UI on click (no auto-prompt at boot).
- [x] 1.2.2 Guest mode + save preserved — `getPlayer({scopes:false})` + localStorage fallback `src/sdk/yandex.ts:163-188`.

## Advertising (§4)
- [x] 4.1 No third-party ads — only `ysdk.adv` calls.
- [x] Interstitial cooldown — `ADS_INTERSTITIAL_COOLDOWN_MS = 60_000` enforced in `showInterstitial()` (`src/sdk/yandex.ts:79-83`).
- [x] 4.7 Sound + gameplay paused during fullscreen ads — `adOpen()` mutes `game.sound` and emits `pause:toggle` (`src/sdk/yandex.ts:65-77`).
- [x] 4.5 Rewarded triggered by user click — `showRewarded()` only invoked from explicit UI buttons (no timer-based calls in `src/`).
- [x] 4.6 Sticky banner only — `showBannerAdv/hideBannerAdv` used; no custom RTB.

## Localization (§2.10, §2.14)
- [x] ru/en/tr present — `src/locales/{ru,en,tr}.ts`, all 213 lines (key parity).
- [x] Auto-detect via SDK — `yandex.getLang()` reads `ysdk.environment.i18n.lang` (`src/sdk/yandex.ts:56-63`), falls back to URL `?lang=` then `navigator.language`.
- [x] Splash localized — `index.html:206-219` localizes title + loading text per detected lang.
- [x] Cyrillic + Turkish glyphs — `manrope-variable-cyrillic.woff2` + `manrope-variable-latin-ext.woff2` preloaded (`index.html:41-43`).

## UX / Stability
- [x] 1.3 Sound stops when tab hidden — `src/main.ts:63-72` `visibilitychange` mutes + sleeps loop.
- [x] 6.3 Pause feature — `pause:toggle` event consumed by `DomPause`/scenes.
- [x] 6.2 Sound toggle — settings modal `DomSettingsModal.ts`.
- [x] No `alert/confirm/prompt` — Grep over `src/` and `dist/` returned 0 matches.
- [x] No external requests beyond Yandex SDK — Grep `https?://` in `src/` only finds W3 SVG namespaces (`DomHUD.ts:178`, `skinPatterns.ts:69`); no `fetch/XHR/axios` to external hosts.
- [x] Mobile fullscreen + responsive — `Phaser.Scale.RESIZE` + `orientationchange` listener (`src/main.ts:30-61`).
- [x] No browser scrollbar — `body { overflow:hidden; touch-action:none }` (`index.html:79-80`).
- [x] 1.23 No interactive AI / LLM features — none in repo.

## Content policy (§3, §8)
- [x] No 18+, politics, religion, esoterics, gambling, real-money — content review of `src/locales/*.ts` clean.
- [x] 8.4.2 No external links — no anchors to social/stores in DOM components (Grep clean).
- [x] 3.7 No real-money purchases — no payments code.
- [?] 3.5 Copyright on all assets — author must confirm `assets/`, `promo/` PNGs are owned/licensed.
- [?] 3.6 Not a clone — name "Split.io" / mechanics genre check left to human.

## Recommended (§6)
- [x] 6.4 No console errors — clean preload in code; e2e left to `playwright`.
- [x] 6.7 No useless UI buttons — DOM panels reviewed.
- [?] 6.1 Contact email — must be filled in Yandex Console (not in repo).

## Promo / metadata (§5)
- [?] 5.1.1 Screenshots ≥70% real gameplay — `promo/`, `*-game.png` exist; visual review by human.
- [?] 5.6 Icon is not a screenshot — verify the uploaded icon in Console.
- [?] 5.12 Unique name per language — set in Console.
