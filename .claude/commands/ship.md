---
description: Финальная проверка перед публикацией на Яндекс Играх
---

Последовательно запусти:
1. `yandex-integrator` — **обязательно** спарсить актуальные требования с yandex.ru/dev/games через WebFetch, сформировать живой чеклист `docs/YANDEX_CHECKLIST_LIVE.md`, пройтись по каждому пункту, автофиксить где возможно. Verdict только после реальной проверки каждой строки.
2. `bun run build` — сборка.
3. Повторно `yandex-integrator` (быстрый прогон) на собранном `dist/`: размер, отсутствие внешних запросов, `index.html` в корне.
4. `promo` — генерация промо-материалов.
5. `bun run pack` — упаковка в zip.

В конце выведи:
- путь к zip
- финальный отчёт yandex-integrator (READY / NEEDS FIXES)
- ссылку: `https://games.yandex.ru/console/games`

Если на шаге 1 verdict = NEEDS FIXES — остановись, не собирай билд, покажи список правок.
