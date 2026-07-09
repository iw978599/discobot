#!/bin/bash
# Deployment script for Discord Synth Bot
# Usage: ./deploy.sh

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo "Please create .env file with your configuration"
    exit 1
fi

# Pull latest changes
echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main

# Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm install

# Build all packages
echo -e "${YELLOW}🔨 Building all packages...${NC}"
npm run build

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed${NC}"
    echo "Install with: npm install -g pm2"
    exit 1
fi

# Restart PM2 processes
echo -e "${YELLOW}🔄 Restarting services...${NC}"
pm2 restart ecosystem.config.js

# Save PM2 configuration
pm2 save

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Check status with: pm2 status"
echo "View logs with: pm2 logs"
echo "Monitor with: pm2 monit"
