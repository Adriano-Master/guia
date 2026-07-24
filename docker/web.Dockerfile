# Web (PWA Angular) — multi-stage (build Angular + nginx enxuto).
# Contexto de build: ../frontend (ver docker-compose.yml).
# O frontend Angular é mantido por outro fluxo de trabalho; este Dockerfile
# assume o output padrão do Angular v17+: dist/frontend/browser.

# ---- build ----
FROM node:lts-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:alpine AS runtime

# Output do build Angular (application builder): dist/frontend/browser.
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

# O nginx.conf (proxy de /api/ para o serviço api) é montado pelo
# docker-compose a partir de docker/nginx.conf.

EXPOSE 80
