# Yandex Game Template

Шаблон для быстрой разработки 2D веб-игр под Яндекс Игры. Стек: Phaser 3 + TypeScript + Vite + Bun.

## Создание новой игры

```powershell
# скопировать шаблон в новую папку
cp -r yandex-game-template ../my-new-game
cd ../my-new-game
npm install
npm dev
```

Затем запусти Claude Code в папке игры:

```
/gdd        — обсудить идею с геймдизайнером, получить GDD
/persona    — анализ ЦА и правки GDD
/skeleton   — архитектура и скелет кода
/ship       — финальная проверка и упаковка
```

## Команды

| Команда | Что делает |
|---|---|
| `npm dev` | Vite dev-server на http://127.0.0.1:5173 |
| `npm run build` | Сборка в `dist/` + валидация Яндекс-требований |
| `npm run pack` | Сборка + zip для загрузки в консоль Яндекса |
| `npm test` | Vitest unit-тесты |
| `npm run test:e2e` | Playwright smoke-тесты |
| `npm run lint` | Biome проверка |
| `npm run typecheck` | TS проверка типов |

## Публикация

1. `npm run pack` → получаешь `<name>-<version>.zip`.
2. https://games.yandex.ru/console/games — загрузи zip.
3. Заполни описания, скриншоты из `promo/`.
4. Отправь на модерацию.

## Структура

```
src/
  main.ts              — точка входа, инициализация Phaser
  config/              — баланс, константы (никаких magic numbers в коде)
  scenes/              — Boot, Preload, Menu, Game, UI, GameOver
  entities/            — игровые сущности (юниты, предметы)
  systems/             — менеджеры (Save, Audio, Locale, Economy)
  ui/                  — переиспользуемые UI-компоненты
  sdk/                 — обертка Yandex SDK (с моком для dev)
  utils/, types/
assets/                — графика, звук, шрифты
docs/                  — GDD, PERSONA, ARCHITECTURE, чеклист Яндекса
promo/                 — иконка, скриншоты, описания
.claude/agents/        — подагенты пайплайна
.claude/commands/      — слэш-команды
scripts/               — pack, validate-yandex, optimize-assets
tests/                 — vitest + playwright
```

## Pre-commit / settings.json

Шаблон НЕ содержит `.claude/settings.json` — добавь его сам после копирования в новую игру, например:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(curl *)",
      "Bash(ffmpeg *)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ]
  }
}
```

## Pipeline ассетов (бесплатные источники)

- **Графика**: ChatGPT MCP (TODO, отдельная сессия) → fallback Pollinations.ai → fallback opengameart.org.
- **Звук**: Freesound API + Pixabay Audio API.
- **Музыка**: Pixabay Music API.

API-ключи в `.env` (см. `.env.example` если есть).
