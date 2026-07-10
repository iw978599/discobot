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

# ---------- PYTHON DEPS BUILD ----------
FROM python:3.11-slim-bookworm AS python-deps
WORKDIR /tmp

# Build tooling for wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && \
    pip wheel --no-cache-dir --wheel-dir /tmp/wheels -r /tmp/requirements.txt

# ---------- APP RUNTIME ----------
FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# System deps: nginx + supervisor + ffmpeg + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create runtime dirs
RUN mkdir -p /app /var/log/supervisor /var/log/nginx /run/nginx

WORKDIR /app

# Install Python dependencies from prebuilt wheels
COPY --from=python-deps /tmp/wheels /tmp/wheels
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/tmp/wheels -r /tmp/requirements.txt && \
    rm -rf /tmp/wheels /tmp/requirements.txt

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
