# Бэкенд «Пункт выдачи»

Cloudflare Worker + D1 + Durable Objects. Адрес:
`https://pvz-backend.qclay-pvz.workers.dev`

## Маршруты

| маршрут | что делает |
|---|---|
| `GET /health` | жив ли сервис и какая модель подключена |
| `POST /auth` | вход по подписи Telegram, заводит игрока |
| `GET /state` | прогресс игрока и его ревизия |
| `POST /state` | сохранить прогресс; при устаревшей ревизии вернёт 409 и серверную версию |
| `GET /leaders` | рейтинг недели |
| `POST /review` | отзыв от модели: один по контексту или пачкой |
| `WS /room/:id` | комната совместной игры |

Каждый запрос требует заголовок `X-Init-Data` с подписью Telegram.
Подпись проверяется HMAC-ом по токену бота — подделать нельзя.

## Секреты

В репозитории их нет и быть не должно. Кладутся в Cloudflare:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put OPENAI_KEY
```

Для локальных тестов токен бота лежит в `server/.dev.vars` — файл в `.gitignore`.

## Развернуть и проверить

```bash
npm run server    # деплой
npm run api       # 11 проверок по живому адресу
```
