# chatgpt-images MCP server

Stdio MCP сервер. Оборачивает залогиненную ChatGPT Pro веб-сессию через Playwright и предоставляет один инструмент `generate_image` для генерации картинок (DALL-E внутри ChatGPT).

## Архитектура

- `src/index.ts` — MCP entry, stdio транспорт, обработчики `tools/list` и `tools/call`.
- `src/browser.ts` — `ChatGPTBrowser`, управление Playwright, извлечение картинок, ретраи.
- `src/queue.ts` — `SerialQueue`, последовательная очередь.
- `src/selectors.ts` — все CSS-селекторы UI ChatGPT в одном месте (чинить здесь при поломке).
- `src/auth.ts` — CLI-скрипт первичного логина.
- `auth/storageState.json` — Playwright storage state (gitignored).
- `logs/<YYYY-MM-DD>.jsonl` — лог запросов (gitignored).

## Установка

```powershell
cd .claude\mcp-servers\chatgpt-images
npm install
# postinstall сам поставит chromium через playwright install
```

## Логин (один раз и при каждом сбросе сессии)

```powershell
npm run auth
```

Откроется headful Chromium на `chatgpt.com`. Залогинься (рекомендуется отдельный аккаунт под автоматизацию — основной могут забанить за automation), дойди до главного экрана. Вернись в терминал и нажми Enter — сессия сохранится в `auth/storageState.json`.

## Сборка

```powershell
npm run build
```

Кладёт скомпилированный JS в `dist/`.

## Подключение к Claude Code

Зарегистрируй сервер на уровне проекта (используется `.mcp.json` в корне шаблона — он уже создан):

```powershell
# Из корня шаблона
claude mcp add chatgpt-images -- node .\.claude\mcp-servers\chatgpt-images\dist\index.js
```

Альтернатива в dev-режиме (без билда):

```powershell
claude mcp add chatgpt-images -- npx tsx .\.claude\mcp-servers\chatgpt-images\src\index.ts
```

Headless по умолчанию **выключен** (живой Chromium снижает риск бана). Включить:

```powershell
claude mcp add chatgpt-images -- node .\.claude\mcp-servers\chatgpt-images\dist\index.js --headless
```

или `CHATGPT_MCP_HEADLESS=1`.

## Tool API

```ts
generate_image({
  prompt: string,
  aspect_ratio: '1:1' | '3:2' | '2:3' | '16:9' | '9:16',
  output_path: string,  // относительный или абсолютный путь
}) => string  // абсолютный путь сохранённого PNG
```

Маппинг на DALL-E внутри ChatGPT:
- `1:1` → 1024×1024
- `3:2`, `16:9` → 1792×1024
- `2:3`, `9:16` → 1024×1792

Между запросами случайная задержка **15–40 сек** (антибот). Очередь последовательная — параллельных вызовов нет.

## Резерв: ручной режим (без MCP)

Если автомат сломался (бан, капча, рассинхрон селекторов) или нужен максимальный контроль качества — агент-artist переключается в **диалоговый ручной режим**: кидает промпты в чат, пользователь отдаёт картинки, агент сохраняет по нужным путям. Логика описана в `.claude/agents/artist.md`. MCP-сервер для этого режима не нужен.

## Ретраи и ошибки

- При rate limit: до 3 попыток с экспоненциальным backoff (30s, 60s, 120s + jitter).
- При капче / Cloudflare challenge / истёкшей сессии: ошибка `manual login required: ...` без ретраев. Лечится `npm run auth`.

## Ручной тест (без Claude)

```powershell
npm run test:manual -- "cute pixel art robot, transparent bg" 1:1 .\tests\manual-out.png
```

Вызывает `ChatGPTBrowser` напрямую и сохраняет одну картинку. Используй до подключения к агенту-artist чтобы убедиться что селекторы живы и сессия валидна.

## Логи

`logs/<date>.jsonl`, по строке на запрос: `{ ts, prompt, aspect, output, saved, durationMs, success, error? }`.

## Известные риски

- **Бан аккаунта.** OpenAI ToS не любит автоматизацию. Используй отдельный аккаунт.
- **Хрупкие селекторы.** Если ChatGPT поменял UI — фикси `src/selectors.ts`.
- **Cloudflare challenge.** Детектится, но не обходится. Перелогин руками.
