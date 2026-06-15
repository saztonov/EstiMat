# syntax=docker/dockerfile:1
# Build context = корень репозитория. API-origin задаётся при сборке:
#   docker build -f client/Dockerfile --build-arg VITE_API_URL=https://api.estimat.example -t estimat-web .

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app

# Абсолютный origin backend API (раздельные домены app.* / api.*).
# Vite вшивает значение в бандл на этапе сборки.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY client ./client
RUN npm run build -w client

# ---------- runtime ----------
FROM nginx:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/client/dist /usr/share/nginx/html
EXPOSE 80
