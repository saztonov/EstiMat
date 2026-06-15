# EstiMat — деплой на VPS (single-VPS baseline)

Развёртывание по корпоративному стандарту v3.1 (`temp/corp_standard_full_single_vps.md`),
этап 1 — быстрый запуск. Keycloak/мониторинг/SES/Lockbox/Container Registry — этап 2.

Плейсхолдеры доменов: `app.estimat.example` (SPA) и `api.estimat.example` (API) — замените на свои.

## Архитектура этапа 1

```
Пользователи ─HTTPS─▶ nginx (infra, :80/:443) ─┬─ app.estimat.example ─▶ estimat-web (SPA)
                                                └─ api.estimat.example ─▶ estimat-api (Fastify :3000)
                                                                              │
                              Yandex Managed PostgreSQL (TLS) ◀──────────────┤
                              S3 Cloud.ru (файлы, presigned) ◀───────────────┘
```

- Два независимых compose-проекта: `estimat` (портал) и `nginx` (ingress), общая сеть `edge`.
- БД — внешний Yandex Managed PostgreSQL (на VPS БД нет).
- Файлы — S3 Cloud.ru (backend stateless, локального диска под загрузки нет).
- Auth — standalone JWT в httpOnly-cookie (этап 2: Keycloak/AD).

> Отступление от стандарта (этап 1): образы собираются **на VPS** (`docker compose build`),
> а не в CI с пушем в Yandex Container Registry (§19). Переход на registry — отдельный шаг.

## Предпосылки

- VPS в Yandex Compute Cloud, Docker + docker compose plugin.
- Firewall/security-group: наружу только `80/tcp` и `443/tcp`; SSH — через VPN/IP allowlist.
- DNS A-записи `app.estimat.example` и `api.estimat.example` → публичный IP VPS.
- Доступ к Yandex Managed PostgreSQL разрешён с IP VPS.
- Bucket в S3 Cloud.ru + сервисные ключи.

## 1. Yandex Managed PostgreSQL (§7, §8)

```sql
-- БД и пользователи
CREATE DATABASE estimat;
CREATE USER estimat_runtime   WITH PASSWORD '...';   -- права на данные (DML)
CREATE USER estimat_migration WITH PASSWORD '...';   -- DDL для миграций

-- Расширения включаются вручную ДО миграций (миграции не делают CREATE EXTENSION):
\c estimat
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- `conn_limit` runtime-пользователя ≥ pool.max (20) + резерв; для single-VPS `runtime_instance_count = 1`.
- Включить backups; PITR при наличии.

## 2. Bucket S3 Cloud.ru (§15)

Создать bucket `estimat-files` (объекты приватные — доступ только через presigned URL).
Сервисный ключ положить в `S3_ACCESS_KEY` / `S3_SECRET_KEY`.

## 3. Первый деплой портала

```bash
# Каталоги и сеть
sudo mkdir -p /opt/portals && cd /opt/portals
git clone <repo-url> estimat && cd estimat
docker network create edge      # один раз на хост

# Окружение (права 600, не коммитится)
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production             # заполнить DB/JWT/CORS/S3

# Origin API для сборки фронта
export VITE_API_URL=https://api.estimat.example

# Сборка образов на VPS
docker compose -f deploy/docker-compose.prod.yml -p estimat build

# Миграции — отдельным шагом (§8). Нужны DDL-права (estimat_migration):
#   вариант: временный .env с DB_USER=estimat_migration
docker compose -f deploy/docker-compose.prod.yml -p estimat run --rm migrate

# Запуск API + SPA (порты наружу не публикуются)
docker compose -f deploy/docker-compose.prod.yml -p estimat up -d estimat-api estimat-web
```

## 4. Инфраструктурный nginx + TLS

```bash
cd /opt/portals/estimat/deploy/infra/nginx
mkdir -p certbot/conf certbot/www

# В conf.d/estimat.conf заменить app.estimat.example / api.estimat.example на свои домены.

# Выпуск сертификата (nginx ещё не запущен — certbot слушает :80 сам):
docker run --rm -p 80:80 \
  -v "$PWD/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d app.estimat.example -d api.estimat.example \
  --email admin@estimat.example --agree-tos --no-eff-email

# Старт ingress (nginx + автопродление certbot)
docker compose -p nginx up -d
```

Продление сертификатов идёт автоматически (certbot renew, webroot). После обновления nginx
должен перечитать конфиг — добавьте перезагрузку по расписанию (cron, ежедневно):

```bash
0 3 * * * docker exec infra-nginx nginx -s reload
```

## 5. Проверка

```bash
curl -fsS https://api.estimat.example/health/live    # {"status":"ok"}
curl -fsS https://api.estimat.example/health/ready   # {"status":"ok"} (есть связь с БД)
# SPA открывается на https://app.estimat.example, логин/refresh работают,
# обложки проектов грузятся из S3, http → https редиректит.
```

## Обновление (portal-scoped, §19)

```bash
cd /opt/portals/estimat
git pull
export VITE_API_URL=https://api.estimat.example
docker compose -f deploy/docker-compose.prod.yml -p estimat build
# если есть новые миграции:
docker compose -f deploy/docker-compose.prod.yml -p estimat run --rm migrate
docker compose -f deploy/docker-compose.prod.yml -p estimat up -d estimat-api estimat-web
curl -fsS https://api.estimat.example/health/ready
```

Деплой не трогает соседние сервисы, nginx и Keycloak. Запрещены глобальные destructive-команды
(`docker system prune -a`, `compose down --volumes`, `rm -rf /opt/portals/*`).

## Backup / Restore (§26)

- **PostgreSQL:** managed-бэкапы Yandex + при необходимости логический дамп:
  `pg_dump --host=$DB_HOST --username=estimat_migration --dbname=estimat -Fc > estimat.dump`
  Restore: `pg_restore --clean --if-exists -d estimat estimat.dump`.
- **S3 Cloud.ru:** объекты `estimat-files` — версионирование/репликация bucket средствами Cloud.ru.
- **Конфигурация:** `.env.production` (вне git, бэкапить отдельно в secret storage),
  `deploy/infra/nginx/certbot/conf` (сертификаты), `conf.d/`.
- **Rebuild VPS:** Docker + `git clone` + восстановить `.env.production` и certbot/conf → пункты 3–4.

## Этап 2 (после быстрого запуска)

Keycloak + AD/LDAP (§9–§12), Sentry/Prometheus/Grafana/Uptime (§20–§22), Amazon SES/Yandex Postbox
(§17), Yandex Lockbox (§18), Yandex Container Registry + CI вместо сборки на VPS (§19),
полный presigned-PUT upload flow (§15), переход к HA (вторая VPS + L7-балансировщик).
