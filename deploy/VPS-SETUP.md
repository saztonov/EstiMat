# Подготовка VPS с нуля (один раз на хост)

Базовая подготовка машины под корпоративные порталы. Выполняется один раз; затем порталы
разворачиваются по `deploy/README.md` (Часть 2). Предполагается **Ubuntu 22.04/24.04** и
подключение через **PuTTY** с Windows. `<IP>` — публичный адрес VPS.

## 0. Подключение через PuTTY
1. PuTTY → *Host Name* `<IP>`, *Port* `22`, тип `SSH`.
2. Если вход по ключу: **PuTTYgen** → *Load* приватный ключ → *Save private key* (`.ppk`);
   в PuTTY *Connection → SSH → Auth → Credentials* → укажите `.ppk`.
3. *Open* → *Accept* host key → *login as:* имя пользователя ВМ.

## 1. Обновить систему
```bash
sudo apt update && sudo apt upgrade -y
```

## 2. Firewall — наружу только 22/80/443 (§3)
```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # лучше: sudo ufw allow from <ваш-IP> to any port 22
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable              # подтвердите 'y'; SSH уже разрешён
sudo ufw status
```
> Если у ВМ есть security group на уровне Yandex Cloud — откройте там 80/443 и ограничьте 22.

## 3. Docker + compose
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```
**Закройте и заново откройте PuTTY** (применить группу `docker`), затем:
```bash
docker version && docker compose version
```

## 4. Каталоги, git, общая сеть
```bash
sudo apt install -y git
sudo mkdir -p /opt/portals /opt/infra && sudo chown $USER:$USER /opt/portals
docker network create edge
```

## 5. Общий ingress (один раз)
После того как клонирован первый портал в `/opt/portals/estimat` (Часть 2.2 в `deploy/README.md`):
```bash
sudo mkdir -p /opt/infra/nginx
sudo cp -r /opt/portals/estimat/deploy/infra-nginx/. /opt/infra/nginx/
cd /opt/infra/nginx && mkdir -p certbot/conf certbot/www
docker compose -p infra-nginx up -d
```

---

Дальше — развёртывание конкретного портала: **`deploy/README.md`, Часть 2**.
Перенос кода без git (если нет remote): WinSCP или `pscp` из комплекта PuTTY, например
`pscp -r C:\Users\Usr\EstiMat <user>@<IP>:/opt/portals/estimat` (предварительно исключив
`node_modules` и `dist`).
