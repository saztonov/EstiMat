# Host-level ingress (общий nginx + certbot)

Это **инфраструктурный компонент уровня хоста**, общий для всех корпоративных порталов на VPS
(§3, §4). Разворачивается **один раз** в `/opt/infra/nginx` и обновляется отдельной процедурой,
не затрагивающей порталы (§19).

> По стандарту (§24) этот компонент должен жить в отдельном **infra-standards репозитории**.
> Здесь он лежит как эталон для bootstrap первого хоста — при появлении infra-репозитория
> перенесите `infra-nginx/` туда и подключайте порталы оттуда.

## Что делает
- TLS termination + HTTP→HTTPS для всех порталов.
- Маршрутизация по `Host` к сервисам порталов в общей docker-сети `edge`.
- ACME-challenge (Let's Encrypt) через webroot для выпуска/продления сертификатов любого портала.
- Дефолтный сервер (`conf.d/00-default.conf`) закрывает запросы с неизвестным `Host`.

## Раскладка на хосте
```
/opt/infra/nginx/
  docker-compose.yml
  conf.d/
    00-default.conf        # общий дефолт (ACME + 444)
    estimat.conf           # ← копия из репо портала (deploy/nginx/estimat.conf)
    <portal-b>.conf        # ← другие порталы
  certbot/
    conf/                  # сертификаты Let's Encrypt (общие)
    www/                   # webroot для ACME-challenge
```

## Добавление портала
1. Выпустить сертификат портала (webroot, nginx уже работает) — см. `deploy/README.md`.
2. Скопировать `conf.d/<portal>.conf` (из репо портала) в `/opt/infra/nginx/conf.d/`.
3. `docker exec infra-nginx nginx -t && docker exec infra-nginx nginx -s reload`.

Деплой/обновление портала **не трогает** этот nginx; nginx обновляется отдельно.
