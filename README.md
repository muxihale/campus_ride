# CampusRide

Учебный сервис совместных поездок студентов и сотрудников **УрФУ, Екатеринбург**. Дата защиты — **9 ноября 2026 года**.

Водитель публикует поездку, пассажир находит её и бронирует места, водитель подтверждает заявку. После завершения участники оставляют двусторонние отзывы. Отмена, оплата и возврат демонстрационные; реальные деньги не используются. Интерактивная карта в первую версию не входит.

## Состояние проекта

Сейчас подготовлен **каркас приложения**, а не готовый сервис бронирования:

- Bun-монорепозиторий: Vite/React, NestJS API и общий пакет UI.
- Пресет shadcn `b1tgce4mm`: Base UI, Luma, Inter, Tailwind CSS, pointer на кнопках.
- Стартовая страница с реальным запросом к API через Vite-прокси `/api`.
- Проверки состояния API и подключения к PostgreSQL, Swagger/OpenAPI.
- API регистрации пассажира, семидневные cookie-сессии и текущий пользователь (`/api/auth/me`).
- Prisma-схема из 17 сущностей, начальная SQL-миграция и ER-диаграмма.
- Конфигурация PostgreSQL, Docker Compose и GitHub Actions.
- Форматирование, линтинг, проверка типов, сборка и HTTP-тесты регистрации с настоящим PostgreSQL.

**Ещё не реализованы:** вход в существующий аккаунт и выход, интерфейс авторизации, проверка прав ролей предметных маршрутов, кабинеты, поездки и фильтры, бронирование, платёжные сценарии, отзывы, уведомления, модерация и seed демо-данных. Регистрация пока доступна через API/Swagger, стартовая страница не содержит формы. Health-запрос не заменяет требуемый сквозной сценарий.

Полный Compose-стек проверен: API и прокси фронтенда соединяются с PostgreSQL. SQL-проверки ограничений выполняются на настоящей БД с откатом тестовых записей. HTTP-тесты состояния используют подмену клиента, а тесты регистрации и сессий — настоящую БД; они создают аккаунты на уникальных доменах `*.campusride.test` и удаляют только свои записи после тестов. CI применяет миграции до запуска HTTP-тестов.

## Документация

- [Функциональная спецификация и критерии приёмки](docs/specification.md).
- [Техническая архитектура и решения](docs/architecture.md).
- [Модель БД и ER-диаграмма](docs/database.md), [исходник draw.io](docs/database.drawio).
- [Фактический и целевой API](docs/api.md).
- [План до защиты](docs/plan.md).

## Стек

Bun 1.4, TypeScript, React/Vite, Tailwind CSS, shadcn/ui (Base UI), NestJS, Prisma ORM 7.10.1, PostgreSQL 17, Docker Compose. Задачи workspaces запускаются через Turborepo. Версии зафиксированы в `bun.lock`; не создавайте параллельные lockfile других менеджеров пакетов.

## Локальная разработка

Понадобятся Bun 1.4.0, Node.js 24+ для инструментов сборки и Docker с Compose для PostgreSQL. Альтернатива Docker — собственный PostgreSQL 17 с URL в `.env`.

Из корня репозитория:

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run db:up
bun run db:generate
bun run db:deploy
bun run dev
```

`db:deploy` применяет существующую начальную миграцию. Запуск `dev` поднимает Vite и NestJS с отслеживанием изменений. Пароли в `.env.example` предназначены только для локальной демонстрации, файл `.env` исключён из Git.

Адреса:

- Интерфейс: <http://localhost:5173>.
- API: <http://localhost:3001/api>.
- Swagger: <http://localhost:3001/api/docs>.
- OpenAPI JSON: <http://localhost:3001/api/docs-json>.

На главной странице кнопка «Проверить подключение» отправляет `GET /api/health`. Запрос виден в DevTools → Network. Кнопка «Документация API» открывает Swagger через тот же прокси.

### Если PostgreSQL пока недоступен

После копирования `.env`, установки зависимостей и генерации клиента можно выполнить `bun run dev` для работы с каркасом. `/api/health` будет доступен, а `/api/health/ready` вернёт `503`. Это ожидаемо без БД; будущие функции предметной области потребуют PostgreSQL и миграций.

## Регистрация через API

Откройте Swagger **через фронтенд**: <http://localhost:5173/api/docs>. Выполните `POST /api/auth/register`, затем `GET /api/auth/me`: браузер сохранит `HttpOnly` cookie автоматически. Используйте новый email, имя от 2 до 100 символов и пароль от 10 до 128 символов. Необязательное поле `affiliation` — до 200 символов. Регистрация назначает только `PASSENGER`; поля ролей, статуса и идентификатора от клиента отклоняются.

Пример из терминала (cookie-файл храните вне репозитория):

```sh
curl -i -c /tmp/campusride.cookies http://localhost:5173/api/auth/register \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5173' \
  --data '{"email":"anna@campusride.test","password":"CampusRide-demo-2026","fullName":"Анна Соколова"}'
curl -b /tmp/campusride.cookies http://localhost:5173/api/auth/me
```

Успешная регистрация возвращает `201` и безопасные данные пользователя, повторный email — `409`, неверные/лишние поля — `400`. Неподходящий или отсутствующий `Origin` даёт `403`: значение должно точно совпадать с `WEB_ORIGIN`. Поэтому интерактивную регистрацию в Swagger выполняйте через порт фронтенда `5173`, а не напрямую через `3001`.

Сессия действует 7 дней; в БД хранится SHA-256-хеш случайного 256-битного токена. Cookie имеет `HttpOnly`, `SameSite=Lax`, `Path=/`, а при `NODE_ENV=production` — `Secure` (требует HTTPS). Истёкшая, удалённая сессия или заблокированный пользователь получают `401`. Ответы с данными пользователя не кэшируются.

Регистрация ограничена десятью попытками в минуту с одного IP, включая неверные формы. Лимит хранится в памяти одного API-процесса и сбрасывается при его перезапуске. За локальным Vite-прокси клиенты могут иметь один IP; недоверенные `X-Forwarded-For` не используются для обхода лимита. Для нескольких серверных процессов потребуется общее хранилище лимитов.

## Docker на macOS через Colima

Для Apple Silicon проверена установка Docker CLI, Compose, Buildx и Colima через Homebrew ([инструкция Colima](https://colima.run/docs/installation/)):

```sh
brew install colima docker docker-compose docker-buildx
mkdir -p "$HOME/.docker/cli-plugins"
ln -s "$(brew --prefix docker-compose)/bin/docker-compose" "$HOME/.docker/cli-plugins/docker-compose"
ln -s "$(brew --prefix docker-buildx)/bin/docker-buildx" "$HOME/.docker/cli-plugins/docker-buildx"
colima start campusride --cpus 4 --memory 4 --disk 24 --vm-type vz --mount-type virtiofs --runtime docker
docker compose version
```

Если плагины уже настроены, повторно создавать ссылки не нужно. Профиль `campusride` использует 4 ГБ памяти; активный Docker context — `colima-campusride`. После перезагрузки VM запускается командой `colima start campusride`. Остановка — `colima stop campusride`; данные сохраняются. Автозапуск при входе в систему не настраивается.

Не запускайте локальные Vite/NestJS и их контейнеры одновременно на одинаковых портах. Для перехода к локальной разработке оставьте БД, остановив только приложения:

```sh
docker compose stop api web
bun run dev
```

Для возврата в контейнерный режим сначала остановите `bun run dev`, затем выполните `docker compose up -d`.

## Полный запуск в Docker

Для этого варианта Bun и Node.js на хосте не нужны — достаточно Docker с Compose:

```sh
cp .env.example .env
docker compose up --build -d
```

Compose поднимает PostgreSQL, применяет миграции при запуске API, ждёт готовности API и запускает собранный фронтенд. Адреса остаются теми же. Используется Vite preview для учебной локальной демонстрации; промышленное развёртывание потребует отдельной конфигурации.

```sh
docker compose logs -f api web
docker compose down
```

Обычный `down` сохраняет данные в именованном томе. Удаление тома уничтожает данные; не добавляйте `-v`, если их нужно сохранить.

## Команды

Все команды выполняются из корня:

```sh
bun run dev              # Оба приложения с отслеживанием изменений
bun run dev:web          # Только фронтенд
bun run dev:api          # Только API
bun run build            # Сборка фронтенда и API
bun run start:api        # Запуск уже собранного API
bun run check            # Генерация Prisma, схема, формат, линтеры, типы, тесты, сборка
bun run format           # Автоформатирование
bun run format:check     # Проверка форматирования
bun run lint             # ESLint / Oxlint
bun run typecheck        # TypeScript
bun run test             # HTTP-тесты; PostgreSQL и миграции обязательны
bun run db:test          # Ограничения в PostgreSQL из Compose; данные откатываются
bun run db:validate      # Проверка Prisma-схемы
bun run db:generate      # Генерация Prisma Client
bun run db:deploy        # Применение существующих миграций
bun run db:migrate --name change_name  # Создание новой миграции в разработке
bun run db:studio        # Просмотр БД через Prisma Studio
bun run db:up            # Только PostgreSQL в Docker
bun run db:down          # Остановка PostgreSQL без удаления данных
```

Для отдельных `typecheck` и `test` на чистой установке сначала выполните `bun run db:generate`. Команда `check` делает это сама. Для `test` и `check` предварительно запустите PostgreSQL и примените миграции (`bun run db:up`, `bun run db:deploy`). Prisma Client генерируется также перед сборкой и запуском API в разработке.

Изменения БД проводятся миграциями. Не заменяйте их `prisma db push`: частичные индексы и дополнительные SQL-ограничения описаны в миграции, а не полностью в Prisma-схеме.

## Структура

```text
apps/
  web/                  React, Vite, стартовая страница
  api/
    prisma/             Схема и SQL-миграции
    src/
      health/           Доступность API и PostgreSQL
      prisma/           Провайдер Prisma
      generated/        Генерируемый клиент; не входит в Git
    test/               HTTP-тесты
packages/
  ui/                   Общие shadcn-компоненты и тема
docs/                  Спецификации, ER-диаграмма и план
.github/workflows/      CI
compose.yaml            PostgreSQL, API и фронтенд
Dockerfile              Сборка образов для демонстрации
```

## Добавление компонентов shadcn

```sh
cd apps/web
bunx --bun shadcn@4.22.1 add input card dialog
```

Команда использует уже настроенный пресет и общие компоненты `packages/ui`. Повторный `init` не нужен. Сгенерированную стартовую тему не следует заменять другим пресетом без согласования.

## Демо и время

Проект рассчитан на пассажира, водителя и администратора; первые две роли можно совмещать. Кабинеты и демо-аккаунты будут добавлены по [плану](docs/plan.md). Сейчас готовых логинов нет.

Предметные даты используют **Asia/Yekaterinburg (UTC+5)**, данные в PostgreSQL хранятся в UTC. Будущее наполнение должно формировать поездки относительно даты запуска, чтобы сценарий оставался рабочим к защите.

## Работа с репозиторием

Спецификации и сообщения коммитов пишутся на русском. Коммиты создаются только по прямому указанию владельца. Файлы `AGENTS.md` и каталог `.agents/` не используются.
