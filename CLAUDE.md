# EstiMat — Правила проекта

## Общение
- Язык общения: русский
- В ответах не писать код — только архитектуру и описание изменений

## Технические ограничения
- **Не использовать RLS** (Row Level Security отключён)
- **Не запускать приложение для теста** — пользователь запускает фронт и бэкэнд самостоятельно
- **ИИ-часть отложена** — нет LangGraph, Claude API, BullMQ, pdf-parse. Сметы и ВОР набираются вручную

## Архитектура
- Адаптированный FSD (Feature-Sliced Design) для Next.js App Router
- `app/` — только роутинг (тонкие page.tsx, layout.tsx, API routes)
- `src/widgets/` — композиции для страниц (собирают features и entities)
- `src/features/` — пользовательские действия (сложные/кросс-доменные)
- `src/entities/` — бизнес-сущности (api, hooks, ui, types, schemas)
- `src/shared/` — generic переиспользуемое (UI-кит, Supabase, утилиты)
- Зависимости строго вниз: app → widgets → features → entities → shared

## Стек
- Next.js 14 App Router + TypeScript
- Shadcn/ui + Tailwind CSS
- Supabase (PostgreSQL + Auth + Storage + Realtime) — облачный проект
- TanStack Query + TanStack Table
- React Hook Form + Zod
- Монорепо: Turborepo + pnpm workspaces
