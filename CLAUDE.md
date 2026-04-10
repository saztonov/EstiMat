# EstiMat — Правила проекта

## Общение
- Язык общения: русский
- Не запускать приложение для теста — пользователь запускает фронт и бэкенд самостоятельно

## Разрешения
- Автоматическое согласие на доступ к файлам проекта (чтение, создание, редактирование)
- Автоматическое согласие на выполнение bash-команд в рамках проекта

## Технические ограничения
- **Без RLS** — авторизация на уровне Fastify middleware
- **Без FSD** — простая страничная структура (pages/components/hooks/store)
- **ИИ-часть отложена** — сметы и ВОР набираются вручную
- **Drizzle в database-first режиме** — SQL-миграции вручную → drizzle-kit pull → автогенерация схемы

## Архитектура
- Клиент-серверная: Fastify REST API + React SPA
- Монорепо (npm workspaces): server/ + client/ + shared/
- server/ — Fastify 5, плагины (database, auth, security, cors), routes, middleware
- client/ — Vite 8 + React 19 + Ant Design 6 + React Router 7
- shared/ — Zod-схемы, типы, константы (переиспользуются в server и client)

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
