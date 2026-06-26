# Keycloak (infra) — корпоративный IdP контура su10

Отдельный инфраструктурный сервис на `backend-vps-1` (§9 корп-стандарта). **Не** часть compose
портала EstiMat, обновляется отдельной процедурой. `deploy-estimat` его не трогает.

- Публичный домен: `auth.su10.ru` (login/logout, OIDC discovery, JWKS).
- Админ-домен: `auth-admin.su10.ru` — только VPN/IP allowlist.
- realm: `su10`, OIDC-клиент портала: `estimat`.
- БД: отдельная `keycloak_db` (Yandex Managed PostgreSQL), пользователь `keycloak_runtime`.

Раскладка на хосте:
```
/opt/infra/keycloak/
  docker-compose.yml
  .env                      # секреты, права 640, НЕ в git
/opt/infra/nginx/conf.d/keycloak.conf
```

---

## 0. Предпосылки (Фаза 0)

1. **DNS:** A-записи `auth.su10.ru` и `auth-admin.su10.ru` → публичный IP `backend-vps-1`.
2. **PostgreSQL:** создать БД `keycloak_db` и пользователя `keycloak_runtime` (отдельный от
   `estimat_runtime`, минимальные права на свою БД). Пересчитать DB connection budget (§7) с
   учётом пула Keycloak. Включить TLS и backup.
3. **Сеть Docker:** `docker network create edge` (если ещё не создана — общая с infra-nginx).
4. **Секреты** (защищённый storage / `.env` 640 root:docker; не выводить в логи и чат):
   `KC_DB_PASSWORD`, `KC_BOOTSTRAP_ADMIN_PASSWORD`. Позже появятся `OIDC_CLIENT_SECRET`
   (Фаза 1) и `LDAP_BIND_PASSWORD` (Фаза 2).

---

## 1. Деплой Keycloak (Фаза 1)

```bash
cd /opt/infra/keycloak
cp .env.example .env          # заполнить реальными значениями
docker compose -p keycloak up -d
docker compose -p keycloak logs -f keycloak   # дождаться "Running the server in ... mode"
```

Наружу порты не публикуются. Проверка изнутри сети edge:
```bash
docker run --rm --network edge curlimages/curl -s http://keycloak:9000/health/ready
```

### nginx-маршруты

```bash
cp /opt/portals/estimat/deploy/infra-nginx/conf.d/keycloak.conf /opt/infra/nginx/conf.d/keycloak.conf
# заполнить <VPN_OR_OFFICE_CIDR> в server-блоке auth-admin.su10.ru
```

### TLS (один SAN-сертификат на оба домена)

Выпустить ДО добавления 443-блоков (иначе nginx не перечитает конфиг):
```bash
docker compose -p infra-nginx run --rm certbot certonly \
  --webroot -w /var/www/certbot -d auth.su10.ru -d auth-admin.su10.ru
docker compose -p infra-nginx exec nginx nginx -s reload
```

Проверка discovery:
```bash
curl -s https://auth.su10.ru/realms/su10/.well-known/openid-configuration | head
```

---

## 2. Настройка realm и клиента (Фаза 1, через auth-admin.su10.ru)

1. Войти в админ-консоль `https://auth-admin.su10.ru` под bootstrap-админом (из доверенной сети).
   Создать **постоянного** админа, затем удалить bootstrap-учётку и убрать `KC_BOOTSTRAP_*` из `.env`.
2. Создать realm **`su10`**.
3. Создать клиент **`estimat`**:
   - Client authentication: **On** (confidential); Standard flow: **On**; PKCE: **On** (S256);
   - Valid redirect URIs: `https://<api-домен EstiMat>/api/auth/oidc/callback` (точный путь);
   - Valid post-logout redirect URIs и Web origins: exact allowlist (без `*`);
   - сохранить сгенерированный **client secret** → секрет `OIDC_CLIENT_SECRET` портала.
4. Client roles клиента `estimat`: `access`, `admin`, `engineer`, `manager`, `contractor` (§12).
5. Client scopes / mappers клиента `estimat`:
   - mapper email и preferred_username;
   - mapper client roles → access token;
   - **Audience mapper**: добавить `estimat` в `aud` (backend валидирует audience).

> С этого момента можно заводить **подрядчиков** как local users (Фаза 3). AD-federation —
> после поднятия IPsec-туннеля (Фаза 2, см. `../keycloak-ad-integration-guide.md`).

---

## 3. Бэкап, восстановление, мониторинг (§9, §20, §21)

**Backup:**
- `keycloak_db` — штатными backup'ами Yandex Managed PostgreSQL (PITR при возможности).
- **realm export** `su10` — регулярно (cron). Пример однократного экспорта в том:
  ```bash
  docker compose -p keycloak exec keycloak \
    /opt/keycloak/bin/kc.sh export --dir /tmp/export --realm su10 --users realm_file
  docker compose -p keycloak cp keycloak:/tmp/export ./backup/realm-su10
  ```

**Restore:** поднять Keycloak на восстановленной `keycloak_db`; при необходимости —
`kc.sh import --dir <export>`. Полная процедура: восстановить БД из backup → `up -d` →
проверить discovery и тестовый вход.

**Мониторинг / uptime (§20):**
- `https://auth.su10.ru/realms/su10/.well-known/openid-configuration` — публичный health;
- внутренний `http://keycloak:9000/health/ready` и `/metrics` (из сети edge / Prometheus).

**Алерты (§21):** Keycloak down, AD/LDAP down, VPN to AD down, TLS expiry, DB near limit.

---

## 4. Обновление версии Keycloak

Отдельная инфраструктурная процедура (не через `deploy-estimat`):
```bash
# 1. сделать realm export + backup keycloak_db
# 2. поднять KEYCLOAK_IMAGE в .env на новый pin-тег
docker compose -p keycloak pull
docker compose -p keycloak up -d
# 3. проверить discovery, вход сотрудника и подрядчика
```

**Опционально (оптимизированный образ, §19):** собрать свой образ с `kc.sh build`
(зашитый `--db=postgres`) → запушить в Yandex Container Registry → в compose заменить
`command: start` на `start --optimized` и `image` на тег из registry. Это убирает auto-build
при старте и соответствует требованию «прод не билдит, а тянет готовый image».
