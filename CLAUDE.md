# EstiMat — Правила проекта

## Общение
- Язык общения: русский
- Промежуточные размышления (reasoning) тоже вести на русском языке
- Не запускать приложение для теста — пользователь запускает фронт и бэкенд самостоятельно

## Разрешения
- Автоматическое согласие на доступ к файлам проекта (чтение, создание, редактирование)
- Автоматическое согласие на выполнение bash-команд в рамках проекта

## Git
- Изолированные коммиты: в коммит включать только правки, сделанные в текущей сессии. Чужие незакоммиченные изменения (от параллельных сессий) не стейджить и не коммитить, даже если они в тех же файлах — точечный `git add` по файлам, а при смешанных файлах — частичное стейджирование (патч в индекс)
- Перед коммитом сверять дифф стейджа с фактически сделанными в сессии правками

## Технические ограничения
- **Без RLS** — авторизация на уровне Fastify middleware
- **Без FSD** — простая страничная структура (pages/components/hooks/store)
- **ИИ-часть отложена** — сметы и ВОР набираются вручную
- **Drizzle в database-first режиме** — SQL-миграции вручную → drizzle-kit pull → автогенерация схемы
- **Миграции совместимы с `deploy-estimat --migrate`** — каждый файл накатывается одним батчем (`node dist/db/migrate.js` → `client.query(sql)` по всему файлу): только чистый SQL без psql-метакоманд (`\d`, `\copy`, `\g`); идемпотентно (`IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DO $$ … pg_trigger`); сквозная нумерация `NNNN_name.sql` без коллизий номера (порядок применения — по алфавиту имени, трекинг в `schema_migrations`). `deploy-estimat --migrate` сам делает полный деплой (build + up API/SPA) и накат миграций — отдельный `deploy-estimat` не нужен

## Архитектура
- Клиент-серверная: Fastify REST API + React SPA
- Монорепо (npm workspaces): server/ + client/ + shared/
- server/ — Fastify 5, плагины (database, auth, security, cors), routes, middleware
- client/ — Vite 8 + React 19 + Ant Design 6 + React Router 7
- shared/ — Zod-схемы, типы, константы (переиспользуются в server и client)

## UI
- Пагинация таблиц-списков: по умолчанию **100** строк на страницу; в переключателе размера — **100 / 200 / 500**. Использовать общий конфиг `DEFAULT_PAGINATION` из `client/src/lib/tableConfig.ts` (вложенные/группированные таблицы со `pagination={false}` — исключение)

## Стек
- Node.js 22 LTS + TypeScript 5.7
- Backend: Fastify 5 + @fastify/jwt + @fastify/cookie + @fastify/helmet + @fastify/rate-limit
- Frontend: Vite 8 + React 19 + React Router 7 + Ant Design 6
- ORM: Drizzle ORM (database-first) + drizzle-kit
- БД: PostgreSQL 17 (Yandex Managed в проде, Docker для локальной разработки)
- Файлы: S3 Cloud.ru (@aws-sdk/client-s3)
- Auth: JWT в httpOnly cookies (access 15 мин + refresh 7 дней)
- Валидация: Zod 4
- State: Zustand 5 + TanStack Query 5

## Роли
- admin — полный доступ
- engineer — инженер-сметчик
- contractor — подрядчик
- manager — руководитель

## Референсные проекты
- BillHub: C:\Users\Usr\billhub (паттерн auth, структура Fastify)
- PassDesk: github.com/loliloopp/PassDesk (Sequelize + Yandex PG)
