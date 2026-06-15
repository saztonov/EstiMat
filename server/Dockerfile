# syntax=docker/dockerfile:1
# Build context = корень репозитория (монорепо npm workspaces):
#   docker build -f server/Dockerfile -t estimat-api .

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app

# Манифесты для установки зависимостей (отдельный слой для кэша).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# Исходники shared + server и production-сборка (esbuild → server/dist).
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
RUN npm run build -w shared && npm run build -w server

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Только production-зависимости монорепо (workspace-симлинк @estimat/shared).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev && npm cache clean --force

# Скомпилированный сервер + SQL-миграции (dist/db/migrations).
COPY --from=builder /app/server/dist ./server/dist

USER node
WORKDIR /app/server
EXPOSE 3000
# Порт наружу не публикуется — доступ только из docker-сети edge через nginx.
CMD ["node", "dist/index.js"]
