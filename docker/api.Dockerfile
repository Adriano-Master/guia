# API NestJS — multi-stage (build + runtime enxuto).
# Contexto de build: ../backend (ver docker-compose.yml).

# ---- build ----
FROM node:lts-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:lts-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# Migrations versionadas aplicadas no start (nunca schema manual em produção).
# O pacote `prisma` (CLI) é dependência de produção justamente para isso.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
