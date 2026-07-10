# syntax=docker/dockerfile:1.7

# ---------- FRONTEND BUILD ----------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /src/ui

# Install deps first for layer caching
COPY ui/package*.json ./
RUN npm ci

# Build UI
COPY ui/ ./
RUN npm run build

# ---------- APP RUNTIME ----------
FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# System deps: nginx + supervisor + ffmpeg + build tooling for any wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    ffmpeg \
    curl \
    ca-certificates \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Create runtime dirs
RUN mkdir -p /app /var/log/supervisor /var/log/nginx /run/nginx

WORKDIR /app

# Python deps first for layer caching
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy backend/service code
COPY . /app

# Copy built frontend into nginx web root
COPY --from=frontend-build /src/ui/dist /usr/share/nginx/html

# Nginx + Supervisor configs (expected in repo root)
COPY nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose HTTP
EXPOSE 80

# Optional healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1/ || exit 1

# Start both services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
