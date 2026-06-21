# Развёртывание Ярлыкона

Этот документ — про то, как поднять свой инстанс. Два пути на выбор.

## Что понадобится в любом случае

1. **GitHub-аккаунт** с возможностью создавать репозитории.
2. **Cloudflare-аккаунт** (бесплатный) с подключённым API-токеном.
3. **Telegram-бот** — создаётся через [@BotFather](https://t.me/BotFather), 30 секунд.
4. **Домен** (опционально, но рекомендуется): без него Pages даёт `username.github.io/yarlykon`, что для шортенера длинновато. Короткий `.ru` стоит ~200 ₽/год.
5. **Yandex Metrika** (опционально): счётчик создаётся в кабинете, нужен только ID.

## Подготовка токенов

### GitHub PAT
- Settings → Developer settings → Personal access tokens → Fine-grained tokens.
- Repository access: только этот репо.
- Permissions: `Contents: Read/Write`, `Pages: Read/Write`, `Secrets: Read/Write`, `Workflows: Read/Write`.
- Сохрани токен сразу, второй раз показан не будет.

### Cloudflare API Token
- Dashboard → My Profile → API Tokens → Create Token.
- Use template **Edit Cloudflare Workers**, добавь `Workers KV Storage: Edit`.
- Account ID посмотри на главной дашборда (правый нижний угол любого зон-овервью).

### Telegram Bot Token
- `/newbot` в @BotFather, имя на своё усмотрение.
- Сразу прими токен и убери из чата.

## Путь A — локальный CLI

Когда подходит: ты за компом, у тебя стоят `node 20+` и `git`.

```sh
# 1. Используй этот репо как template — кнопка "Use this template" в GitHub.
# 2. Склонируй свою копию:
git clone https://github.com/{owner}/yarlykon.git
cd yarlykon

# 3. Запусти визард:
bash scripts/bootstrap.sh
```

Визард задаст вопросы по `REQUIRED_FIELDS`, прогонит 8 стадий, по ходу будет писать прогресс. Если что-то сломалось — перезапусти с того же места:

```sh
bash scripts/bootstrap.sh --stage=4         # повторить только стадию 4
bash scripts/bootstrap.sh --stage=4 --force # принудительно
```

Состояние пишется в `.bootstrap-state.json` (gitignored).

## Путь B — GitHub Actions wizard

Когда подходит: ты с мобилы и не хочешь ставить node/wrangler локально.

1. **Use this template** → создаёшь свою копию репо.
2. Settings → Secrets and variables → Actions, добавь:
   - `YARLYKON_GH_PAT` — твой PAT.
   - `CF_API_TOKEN` — Cloudflare API token.
   - `TG_BOT_TOKEN` — токен бота.
   - `METRIKA_ID` — опционально.
3. Actions → workflow `bootstrap` → **Run workflow**.
4. Заполни инпуты: `pages_domain`, `allowed_users`, `cf_account_id`, `slug_mode`.
5. Запусти. Логи покажут 8 стадий, на каждой галочка либо ошибка.

Перезапуск отдельной стадии — снова Run workflow, в `stage` укажи цифру.

## После развёртывания

1. Открой бот в Telegram, нажми кнопку меню (`Ярлыкон`) — должен открыться Mini App.
2. Введи 1–5 ссылок, жми «Сократить».
3. Дождись 30–60 секунд пересборки Pages.
4. Открой полученную короткую ссылку — должна вести на цель, превью корректное.

## Типичные проблемы

**Mini App не открывается из бота.** Проверь, что `setMenuButton` указал на правильный URL — должен совпадать с `https://{pages_domain}/miniapp/`. Стадия 6 это делает; перезапусти `--stage=6`, если меняешь домен.

**Ссылка ведёт на 404 GitHub Pages.** Pages ещё пересобирается. Подожди 60 секунд. Если упорно 404 — проверь Actions tab у репо, не упал ли rebuild.

**Worker отвечает 401.** `auth` от Mini App не проходит проверку. Проверь, что `TG_BOT_TOKEN` — тот же, что у бота, в котором открыли Mini App.

**Worker отвечает 403.** Юзер не в `ALLOWED_USERS`. Добавь свой `tg:{id}` в переменную и `wrangler deploy` ещё раз (или прогони стадию 4 заново).

**OG-превью пустые.** У источника нет OG-тегов или фетч упал (CORS, антибот). В `index.json` будет `og.partial=true`. Можешь отредактировать запись вручную через PR и запустить refresh.

**В Telegram превью пустое после публикации.** Telegram кэширует первый показ. Если в HTML на момент его захода не было OG — кэш будет пустым. Решения: переименовать slug (новая ссылка), либо очистить кэш через @WebpageBot.
