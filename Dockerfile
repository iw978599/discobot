# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
COPY bot/package.json ./bot/package.json
COPY engine/package.json ./engine/package.json
COPY web/package.json ./web/package.json
COPY ui/package.json ./ui/package.json

RUN npm ci

COPY tsconfig.json ./tsconfig.json
COPY bot/ ./bot/
COPY engine/ ./engine/
COPY web/ ./web/
COPY ui/ ./ui/

RUN npm run build

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

RUN mkdir -p /app /var/log/supervisor /var/log/nginx /run/nginx
WORKDIR /app

COPY package*.json ./
COPY bot/package.json ./bot/package.json
COPY engine/package.json ./engine/package.json
COPY web/package.json ./web/package.json
COPY ui/package.json ./ui/package.json

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bot/dist ./bot/dist
COPY --from=build /app/engine/dist ./engine/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/ui/dist /usr/share/nginx/html

COPY nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1/api/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
