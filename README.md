# CampusRide

Учебный сервис совместных поездок студентов и сотрудников **УрФУ, Екатеринбург**. Дата защиты — **9 ноября 2026 года**.

Водитель публикует поездку, пассажир находит её и бронирует места, водитель подтверждает заявку. После завершения участники оставляют двусторонние отзывы. Отмена, оплата и возврат демонстрационные; реальные деньги не используются. Интерактивная карта в первую версию не входит.

## Состояние проекта

Сейчас подготовлен **каркас приложения**, а не готовый сервис бронирования:

- Bun-монорепозиторий: Vite/React, NestJS API и общий пакет UI.
- Пресет shadcn `b1tgce4mm`: Base UI, Luma, Inter, Tailwind CSS, pointer на кнопках.
- Стартовая страница с реальным запросом к API через Vite-прокси `/api`.
- Проверки состояния API и подключения к PostgreSQL, Swagger/OpenAPI.
- Prisma-схема из 17 сущностей, начальная SQL-миграция и ER-диаграмма.
- Конфигурация PostgreSQL, Docker Compose и GitHub Actions.
- Форматирование, линтинг, проверка типов, сборка и четыре HTTP-теста.

**Ещё не реализованы:** регистрация и сессии, кабинеты ролей, поездки и фильтры, бронирование, платежные сценарии, отзывы, уведомления, модерация и seed демо-данных. Health-запрос подтверждает связь компонентов, но не заменяет требуемый сквозной сценарий.

Полный Compose-стек проверен: Docker-образы фронтенда и API собраны, PostgreSQL 17 запущен через Docker/Colima, API и прокси фронтенда возвращают успешную проверку соединения с БД. Начальная миграция применена, повторное применение безопасно, различий между живой БД и Prisma-схемой нет. SQL-проверки ограничений выполняются на настоящей БД с откатом тестовых записей. HTTP-тесты отдельно используют подмену клиента БД. Удалённый CI запустится после первого коммита и push.

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
bun run test             # HTTP-тесты API без живой БД
bun run db:test          # Ограничения в PostgreSQL из Compose; данные откатываются
bun run db:validate      # Проверка Prisma-схемы
bun run db:generate      # Генерация Prisma Client
bun run db:deploy        # Применение существующих миграций
bun run db:migrate --name change_name  # Создание новой миграции в разработке
bun run db:studio        # Просмотр БД через Prisma Studio
bun run db:up            # Только PostgreSQL в Docker
bun run db:down          # Остановка PostgreSQL без удаления данных
```

Для отдельных `typecheck` и `test` на чистой установке сначала выполните `bun run db:generate`. Команда `check` делает это сама. Prisma Client генерируется также перед сборкой и запуском API в разработке.

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
