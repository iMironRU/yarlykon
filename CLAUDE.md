# Гайд для Claude Code

Этот файл — точка входа для работы с репозиторием в Claude Code. Прочитай до начала любой задачи.

## Карта репозитория

```
yarlykon/
├── README.md              ← общая информация (для людей)
├── ARCHITECTURE.md        ← решения и обоснования (читать целиком в начале сессии)
├── konspekt.md            ← инварианты (держать в фокусе постоянно)
├── CLAUDE.md              ← этот файл
├── LICENSE                ← MIT
│
├── .github/workflows/     ← bootstrap.yml (мастер развёртывания), rebuild.yml
│
├── worker/                ← Cloudflare Worker (TypeScript)
│   ├── src/
│   │   ├── index.ts       ← роутер: /api/*, /webhook/*
│   │   ├── og.ts          ← фетч и парсинг OG-тегов
│   │   ├── slug.ts        ← генерация slug, проверка коллизий
│   │   ├── github.ts      ← Trees API: атомарный батч-коммит
│   │   └── adapters/
│   │       ├── telegram.ts  ← initData HMAC verify (полная реализация)
│   │       ├── vk.ts        ← задел (TODO)
│   │       └── max.ts       ← задел (TODO)
│   ├── wrangler.toml.tmpl
│   └── package.json
│
├── miniapp/               ← Mini App (vanilla HTML/JS/CSS)
│   ├── index.html
│   ├── app.js             ← платформо-агностичная логика
│   └── style.css          ← TG theme vars based
│
├── template/              ← шаблоны страниц
│   ├── link.html.tmpl     ← редирект-страница с OG + Метрика + UA-sniff
│   └── 404.html
│
├── scripts/               ← bootstrap движок
│   ├── bootstrap.sh       ← CLI обёртка
│   ├── bootstrap.mjs      ← основной движок (8 стадий)
│   └── lib/               ← адаптеры github/cloudflare/telegram
│
├── seed/                  ← первоначальное состояние репо
│   ├── index.json
│   ├── admin/index.html
│   └── l/.gitkeep
│
└── docs/
    └── BOOTSTRAP.md       ← подробности развёртывания
```

## С чего начинать в новой сессии

1. Прочитай `ARCHITECTURE.md` целиком. Это ~10 минут.
2. Пройди `konspekt.md` — 15 инвариантов, держи их в голове до конца сессии.
3. По задаче открой соответствующий модуль:
   - **Платформенный адаптер** → `worker/src/adapters/{platform}.ts`
   - **Логика коротких ссылок** → `worker/src/{slug,og,github}.ts`, `worker/src/index.ts`
   - **Внешний вид/UX** → `miniapp/`, `template/link.html.tmpl`
   - **Развёртывание** → `scripts/bootstrap.mjs`, `.github/workflows/bootstrap.yml`

## Конвенции автора

- **Грамматический принцип:** существительные → сущности, глаголы → команды, состояния → флаги, события → лог-журнал. Применяется и к именованию переменных, и к роутам.
- **Терсе, peer-level.** В комментариях, в коммит-мессах, в обсуждении.
- **Single source of truth везде.** Если поле дублируется, один из дубликатов — это представление, и помечается им.
- **«-кон» суффикс** в имени продукта, не в коде. Внутри кода — `yarlykon`, `Link`, `Slug` и т.д.

## TODO-маркеры в коде

В скелете используются три уровня:

- `// TODO(v1):` — нужно для первой работающей версии. Закрыть в первой сессии Code.
- `// TODO(adapter):` — реализация платформенного адаптера (VK/MAX). Может ждать.
- `// TODO(later):` — расширение, не блокирует v1.

Сделанные TODO удаляй, не оставляй галочки в комментариях — git помнит.

## Команды для проверки

```sh
# Worker dev
cd worker && npm run dev

# Worker deploy (требует wrangler login)
cd worker && npm run deploy

# Mini App локально (любой статик-сервер)
cd miniapp && python3 -m http.server 8080

# Bootstrap локально
bash scripts/bootstrap.sh
```

## Если сомневаешься

Возвращайся к `konspekt.md`. Если инвариант неудобен и хочется обойти — лучше вынеси на обсуждение, чем сломай тихо.

## Что НЕ делать

- **Не вводи СУБД.** Никакого Postgres, никакого D1, никакого SQLite. Git + JSON + опциональный KV — всё.
- **Не выводи бизнес-логику в Mini App.** Mini App — только UI, валидация поверхностная. Вся правда в Worker.
- **Не перекраивай структуру `index.json`** без обновления `ARCHITECTURE.md` и `konspekt.md`.
- **Не оставляй секреты в коде.** Даже в комментариях, даже в примерах.
