# Yandex Games — Pre-publish Checklist

## SDK
- [ ] Тег `<script src="https://yandex.ru/games/sdk/v2"></script>` в `index.html`
- [ ] `YaGames.init()` в `src/sdk/yandex.ts`
- [ ] `LoadingAPI.ready()` после загрузки ассетов
- [ ] `GameplayAPI.start()/stop()` оборачивают активный геймплей
- [ ] Cloud save через `player.setData/getData` + локальный fallback
- [ ] Лидерборды (если есть в GDD)

## Реклама
- [ ] Интерстишал не чаще 1 раза в 60 сек
- [ ] Rewarded — только по явному действию
- [ ] При показе рекламы — pause геймплея и mute звука
- [ ] После закрытия — restore

## Поведение
- [ ] Pause при `visibilitychange` (вкладка скрыта)
- [ ] Mute при потере фокуса
- [ ] Никаких `alert()`, `confirm()`, `prompt()`
- [ ] Адаптивно: 1280×720 desktop + 360×640 mobile portrait/landscape

## Локализация
- [ ] `assets/locales/ru.json` — обязательно
- [ ] `assets/locales/en.json` — обязательно
- [ ] `assets/locales/tr.json` — обязательно (для топ-выдачи)
- [ ] Все строки в UI — через `locale.t()`
- [ ] Шрифт поддерживает кириллицу + турецкие диакритики

## Контент
- [ ] Без упоминаний алкоголя, наркотиков, политики, азартных игр
- [ ] Без насилия 18+
- [ ] Без копирайт-нарушений (бренды, персонажи)
- [ ] Без ссылок на внешние сайты, соцсети, мессенджеры
- [ ] Без упоминаний других игровых платформ

## Технически
- [ ] Размер билда ≤ 100 MB (`bun run build` показывает)
- [ ] Имена файлов: только `[a-z0-9_-.]`, без кириллицы и пробелов
- [ ] Все ассеты — относительные пути
- [ ] Никаких внешних HTTP-запросов кроме Yandex SDK / Metrica
- [ ] WebP для крупных текстур, атласы для спрайтов
- [ ] Аудио: ogg + m4a fallback для Safari

## Промо
- [ ] `promo/icon-1024.png` (1024×1024)
- [ ] 5-10 скриншотов 1280×720 в `promo/`
- [ ] Описания на ru/en/tr (`promo/description.{lang}.md`)
- [ ] Категория и теги в `promo/meta.json`

## Финальный прогон
- [ ] `bun run typecheck` — без ошибок
- [ ] `bun run lint` — без ошибок
- [ ] `bun test` — все зелёные
- [ ] `bun run build` — валидатор проходит
- [ ] Ручной прогон в браузере: меню → игра → reward → game over → retry — без багов
- [ ] Тест на мобильном (Chrome DevTools, эмуляция iPhone/Android)
