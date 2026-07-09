# Multi-stage build for Discord Synth Bot

FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files for all workspaces
COPY package*.json ./
COPY tsconfig.json ./
COPY bot/package*.json ./bot/
COPY engine/package*.json ./engine/
COPY web/package*.json ./web/
COPY ui/package*.json ./ui/

# Install dependencies
RUN npm install

# Copy source code
COPY bot/ ./bot/
COPY engine/ ./engine/
COPY web/ ./web/
COPY ui/ ./ui/

# Build all packages
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Install PM2 for process management
RUN npm install -g pm2

# Copy built files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/bot/dist ./bot/dist
COPY --from=builder /app/bot/package.json ./bot/
COPY --from=builder /app/engine/dist ./engine/dist
COPY --from=builder /app/engine/package.json ./engine/
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/web/package.json ./web/
COPY --from=builder /app/ui/dist ./ui/dist

# Copy PM2 ecosystem file
COPY ecosystem.config.js ./

# Create logs directory
RUN mkdir -p logs

# Expose ports
EXPOSE 3001 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start with PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
