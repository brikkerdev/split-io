# Yandex Game — Project Rules

## Stack
Phaser 3.90+ / TypeScript strict / Vite / Bun / Biome / Vitest / Playwright.

## Workflow
1. `/gdd` — gamedesigner ведёт диалог, пишет `docs/GDD.md`.
2. `/persona` — researcher формирует `docs/PERSONA.md` и правит GDD.
3. `/skeleton` — architect пишет `docs/ARCHITECTURE.md` и каркас в `src/`.
4. Реализация фич — через `dev` подагента.
5. Графика — `artist`. Звук — `sound`.
6. `/ship` — yandex-integrator + promo + pack.

## Code rules
- TS строгий, без `any` и `@ts-ignore`.
- Magic numbers — в `src/config/`, не в коде.
- События между сценами — через `scene.events`/`game.events`.
- Saves/Yandex/Locale — единственные синглтоны (`saves`, `yandex`, `locale`).
- Object pooling для частых спавнов.
- Атласы вместо отдельных текстур.
- Имена ассетов — только `[a-z0-9_-]`.

## Yandex requirements (always)
- Размер билда ≤ 100MB.
- Локализация ru/en/tr обязательна.
- `gameReady()` после загрузки.
- Pause при `visibilitychange` (есть в `main.ts`).
- Интерстишал ≥ 60 сек cooldown (есть в обертке).
- Без внешних запросов кроме Yandex SDK.
- Без `alert/confirm/prompt`.
- Без 18+, политики, копирайтов.

## Don't
- Не ставь новые npm-пакеты без запроса.
- Не пиши README/доки без запроса.
- Не комментируй очевидное.
- Не создавай файлы вне структуры шаблона.
- Не используй Unity, не предлагай 3D.
