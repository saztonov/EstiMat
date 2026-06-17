# EstiMat — деплой на VPS (single-VPS baseline, multi-portal)

Развёртывание по корпоративному стандарту v3.1 (`temp/corp_standard_full_single_vps.md`),
этап 1 — быстрый запуск. Keycloak/мониторинг/SES/Lockbox/Container Registry — этап 2.

На одной VPS размещается **несколько корпоративных порталов** (§4): общий ingress (nginx) и Keycloak
разворачиваются отдельно и обслуживают все порталы, а каждый портал — изолированный compose-проект.
Деплой одного портала не затрагивает соседние, nginx и Keycloak (§19).

Плейсхолдеры: `<IP>` — публичный адрес VPS; домены портала EstiMat — `app.estimat.example` (SPA) и
`api.estimat.example` (API). Замените на свои.

## Архитектура

```
                          VPS (один публичный IP)
Пользователи ─HTTPS─▶ /opt/infra/nginx  (общий nginx + certbot, проект infra-nginx)
                          ├─ app.estimat.example ─▶ estimat-web   ┐
                          ├─ api.estimat.example ─▶ estimat-api   ├─ /opt/portals/estimat  (проект estimat)
                          ├─ app.portal-b.example ─▶ portalb-web  ┘
                          └─ ...                                   ─ /opt/portals/portal-b  (проект portal-b)
                                  сеть edge (общая)
   Yandex Managed PostgreSQL (БД на портал)        S3 Cloud.ru (bucket на портал)
```

- **Host-level (один раз на VPS):** docker-сеть `edge`, общий nginx+certbot в `/opt/infra/nginx`.
- **Per-portal:** `/opt/portals/<portal>` — отдельный compose-проект, своя БД, свой bucket, свои домены,
  свой `*.conf` в общем nginx.
- Файлы — в S3 (backend stateless). Auth — standalone JWT в cookie (этап 2: Keycloak/AD).

**Раскладка на хосте (контейнеры + FHS-гибрид):**

| Путь | Что лежит |
|---|---|
| `/opt/portals/estimat` | код портала + сборка образов (git-чекаут) |
| `/etc/estimat/estimat.env` | конфиг и секреты (FHS host-config, `640 root:docker`) |
| `/usr/local/bin/deploy-estimat` | симлинк на деплой-скрипт `deploy/deploy-estimat.sh` |
| `/opt/infra/nginx` | общий ingress хоста (nginx + certbot + сертификаты) |

Статика — в образе `estimat-web`, состояние — в S3+Managed PG, логи — `docker logs`/journald
(каталоги `/srv`, `/var/lib`, `/var/log` не вводятся — это контейнерная модель).

> Отступление от стандарта (этап 1): образы собираются **на VPS** (`docker compose build`), а не в CI
> с пушем в Yandex Container Registry (§19). Переход на registry — отдельный шаг.

---

# ЧАСТЬ 1. Настройка хоста (один раз на VPS)

Выполняется при подготовке VPS к первому порталу. Для последующих порталов — пропускается.

### 1.1. Базовое
- ОС Ubuntu 22.04/24.04, пользователь с `sudo`.
- Firewall: наружу только `80/443`, SSH (`22`) — с доверенных IP/через VPN.
- Установлены Docker Engine + compose plugin.
(Подробные команды для свежей машины — в `deploy/VPS-SETUP.md`.)

### 1.2. Общая docker-сеть
```bash
docker network create edge
```

### 1.3. Общий ingress (nginx + certbot)
Эталон лежит в репо первого портала (`deploy/infra-nginx/`); по стандарту (§24) позже выносится
в отдельный infra-репозиторий.
```bash
sudo mkdir -p /opt/infra/nginx
sudo cp -r /opt/portals/estimat/deploy/infra-nginx/. /opt/infra/nginx/
cd /opt/infra/nginx
mkdir -p certbot/conf certbot/www
docker compose -p infra-nginx up -d        # поднимется с дефолтным конфигом (только :80 + ACME)
docker compose -p infra-nginx ps
```

---

# ЧАСТЬ 2. Развёртывание портала EstiMat

### 2.1. Внешние ресурсы портала

**Yandex Managed PostgreSQL (§7, §8)** — отдельная БД и пользователи на каждый портал:
```sql
CREATE DATABASE estimat;
CREATE USER estimat_runtime   WITH PASSWORD '...';   -- DML
CREATE USER estimat_migration WITH PASSWORD '...';   -- DDL для миграций
\c estimat
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```
- **Connection budget:** `conn_limit` runtime-пользователя ≥ `DB_POOL_MAX` (20) + резерв. Суммарно по всем
  порталам `Σ conn_limit ≤ max_connections − резервы`. Пересчитывайте ДО добавления нового портала.
- Включить backups; PITR при наличии; доступ к PG — только с IP VPS.

**S3 Cloud.ru (§15):** bucket `estimat-files` (объекты приватные) + сервисный ключ.

**DNS:** A-записи `app.estimat.example` и `api.estimat.example` → `<IP>`.

### 2.2. Код и окружение
```bash
sudo mkdir -p /opt/portals && sudo chown $USER:$USER /opt/portals
cd /opt/portals
git clone <repo-url> estimat           # либо перенос кода (см. VPS-SETUP.md)
cd estimat

# Конфиг и секреты — host-specific, в /etc/estimat/estimat.env (FHS, права 640 root:docker):
sudo mkdir -p /etc/estimat
sudo install -m 640 -o root -g docker .env.production.example /etc/estimat/estimat.env
openssl rand -base64 48                 # сгенерировать JWT-секреты (дважды)
sudo nano /etc/estimat/estimat.env      # DB(Managed PG, DB_SSL=true), JWT, CORS_ORIGIN=https://app..., S3, VITE_API_URL

# Деплой-скрипт в PATH (симлинк на версионируемый скрипт в репо):
sudo ln -sf /opt/portals/estimat/deploy/deploy-estimat.sh /usr/local/bin/deploy-estimat
```

### 2.3. Сборка, миграции, запуск (portal-scoped)
```bash
# Первый запуск с миграциями (нужны DDL-права — временно укажите estimat_migration
# в /etc/estimat/estimat.env, накатите, верните estimat_runtime):
deploy-estimat --migrate

docker compose -f deploy/docker-compose.prod.yml -p estimat ps
docker compose -f deploy/docker-compose.prod.yml -p estimat logs --tail=50 estimat-api
```
> `deploy-estimat` читает `/etc/estimat/estimat.env`, экспортирует `VITE_API_URL`, делает
> `git pull` + `build` + (`--migrate`) + `up -d`. Ручной путь без скрипта:
> `export VITE_API_URL=…; docker compose -f deploy/docker-compose.prod.yml -p estimat build && … up -d`.

### 2.4. Подключение портала к общему ingress
```bash
# 1) Выпустить сертификат (webroot, общий nginx уже работает и обслуживает ACME):
docker run --rm \
  -v /opt/infra/nginx/certbot/conf:/etc/letsencrypt \
  -v /opt/infra/nginx/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d app.estimat.example -d api.estimat.example \
  --email admin@estimat.example --agree-tos --no-eff-email

# 2) Подключить server-блоки портала (заменив домены) и перечитать nginx:
sed 's/app.estimat.example/app.estimat.example/; s/api.estimat.example/api.estimat.example/' \
  /opt/portals/estimat/deploy/nginx/estimat.conf | sudo tee /opt/infra/nginx/conf.d/estimat.conf >/dev/null
#   (или просто скопируйте и отредактируйте домены: nano /opt/infra/nginx/conf.d/estimat.conf)
docker exec infra-nginx nginx -t
docker exec infra-nginx nginx -s reload
```

Если на хосте ещё не настроен ежедневный reload после автопродления сертификатов — добавьте (один раз):
```bash
(crontab -l 2>/dev/null; echo "0 3 * * * docker exec infra-nginx nginx -s reload") | crontab -
```

### 2.5. Проверка
```bash
curl -fsS https://api.estimat.example/health/live     # {"status":"ok"}
curl -fsS https://api.estimat.example/health/ready    # {"status":"ok"} — есть связь с БД
```
Откройте `https://app.estimat.example` — интерфейс грузится, логин/refresh работают, обложки проектов
отдаются из S3, HTTP редиректит на HTTPS.

---

## Обновление портала (portal-scoped, §19)
```bash
deploy-estimat              # git pull + build + up + health
deploy-estimat --migrate    # то же + накат новых миграций (нужны DDL-права в estimat.env)
```
Не трогает соседние порталы, nginx и Keycloak. Запрещены глобальные destructive-команды
(`docker system prune -a`, `compose down --volumes`, `rm -rf /opt/portals/*`).

## Добавление ещё одного портала
Часть 1 уже сделана. Для нового портала повторите Часть 2 с его значениями: каталог
`/opt/portals/<portal>`, проект `-p <portal>`, своя БД/bucket/домены, свой `conf.d/<portal>.conf`.
Имена сервисов в сети `edge` должны быть уникальны (`estimat-api`, `portalb-api`, …).

## Backup / Restore (§26)
- **PostgreSQL:** managed-бэкапы Yandex + логический дамп при необходимости:
  `pg_dump --host=$DB_HOST --username=estimat_migration --dbname=estimat -Fc > estimat.dump`;
  restore: `pg_restore --clean --if-exists -d estimat estimat.dump`.
- **S3 Cloud.ru:** объекты `estimat-files` — версионирование/репликация средствами Cloud.ru.
- **Конфигурация:** `/etc/<portal>/<portal>.env` каждого портала (вне git → secret storage),
  `/opt/infra/nginx/certbot/conf` (сертификаты) и `/opt/infra/nginx/conf.d` (конфиги).
- **Rebuild VPS:** Docker + сеть `edge` → восстановить `/opt/infra/nginx` (Часть 1) → по каждому
  порталу: `git clone` + `/etc/<portal>/<portal>.env` + симлинк `deploy-<portal>` → Часть 2.

## Этап 2 (после быстрого запуска)
Keycloak + AD/LDAP (§9–§12) в `/opt/infra/keycloak` (общий, отдельный compose), Sentry/Prometheus/
Grafana/Uptime (§20–§22), SES/Postbox (§17), Yandex Lockbox (§18), Yandex Container Registry + CI
вместо сборки на VPS (§19), полный presigned-PUT upload flow (§15), переход к HA.
Усиление: верификация TLS-CA Managed PostgreSQL (сейчас `rejectUnauthorized:false`; §18 — путь к CA-сертификату).
