# Deployment Guide

This guide covers hosting the Discord Synth Bot on various platforms.

## Overview

This application has 4 components that need to run:
1. **Discord Bot** - Node.js process (needs to run 24/7)
2. **Web API Server** - Express on port 3001
3. **WebSocket endpoint** - served by the web API on `/ws` (port 3001)
4. **Web UI** - Static React app (served via nginx or Express)

## Quick Comparison

| Platform | Difficulty | Cost | Best For |
|----------|-----------|------|----------|
| VPS (DigitalOcean, Linode) | Medium | $5-10/mo | Full control |
| Railway | Easy | Free tier/$5+ | Quick deploy |
| Render | Easy | Free tier/$7+ | Simple setup |
| AWS EC2 | Hard | $5-20/mo | Scalability |
| Self-hosted | Medium | Hardware cost | Learning/hobby |

---

## Option 1: VPS (Recommended) - DigitalOcean, Linode, etc.

**Best for**: Full control, production use  
**Cost**: ~$6/month  
**Difficulty**: Medium

### Prerequisites
- VPS with Ubuntu 22.04 (minimum 1GB RAM)
- Domain name (optional but recommended)

### Step 1: Server Setup

```bash
# SSH into your server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install nginx
apt install -y nginx

# Install PM2 (process manager)
npm install -g pm2

# Install git
apt install -y git
```

### Step 2: Deploy Application

```bash
# Clone your repo
cd /var/www
git clone https://github.com/iw978599/discobot.git
cd discobot

# Install dependencies
npm install

# Build all packages
npm run build

# Create production .env
nano .env
```

Add your environment variables:
```bash
DISCORD_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id
WEB_PORT=3001
NODE_ENV=production
```

### Step 3: Setup PM2

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'discord-bot',
      cwd: '/var/www/discobot/bot',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'web-server',
      cwd: '/var/www/discobot/web',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

Start services:
```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command it outputs
```

### Step 4: Configure Nginx

Create `/etc/nginx/sites-available/discobot`:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (use certbot - see below)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Serve static UI files
    location / {
        root /var/www/discobot/ui/dist;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /ws/ {
        proxy_pass http://localhost:3001/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

Enable the site:
```bash
ln -s /etc/nginx/sites-available/discobot /etc/nginx/sites-enabled/
nginx -t  # Test config
systemctl restart nginx
```

### Step 5: Setup SSL (HTTPS)

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d your-domain.com

# Auto-renewal is setup automatically
```

### Step 6: Firewall

```bash
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

### Maintenance

```bash
# View logs
pm2 logs

# Restart services
pm2 restart all

# Update code
cd /var/www/discobot
git pull
npm install
npm run build
pm2 restart all

# Monitor
pm2 monit
```

---

## Option 2: Railway (Easiest)

**Best for**: Quick deployment, no DevOps  
**Cost**: Free tier, then $5/month  
**Difficulty**: Easy

### Setup

1. **Sign up** at https://railway.app
2. **Connect GitHub**: Link your repo
3. **Create services** (need 2 services):

#### Service 1: Bot + Web + WebSocket
```bash
# Railway will auto-detect package.json

# Set these environment variables in Railway dashboard:
DISCORD_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id
WEB_PORT=$PORT  # Railway provides this
NODE_ENV=production

# Build command:
npm install && npm run build

# Start command:
node bot/dist/index.js & node web/dist/index.js
```

#### Service 2: Static UI
- Deploy from `ui/` subdirectory
- Build command: `npm install && npm run build`
- Publish directory: `dist`

4. **Get URLs**: Railway gives you public URLs
5. **Update UI**: Point UI to your API URL (update WebSocket URL in UI code)

---

## Option 3: Render

**Best for**: Simple deployment  
**Cost**: Free tier (spins down after inactivity), $7/mo for always-on  
**Difficulty**: Easy

### Setup

1. **Sign up** at https://render.com
2. **Create Web Services**:

#### Service 1: Bot + API
- **Type**: Web Service
- **Repo**: Your GitHub repo
- **Build Command**: `npm install && npm run build`
- **Start Command**: `node bot/dist/index.js & node web/dist/index.js`
- **Environment Variables**: Add all from `.env`

#### Service 2: Static UI
- **Type**: Static Site
- **Build Command**: `cd ui && npm install && npm run build`
- **Publish Directory**: `ui/dist`

3. **Configure**: Point UI to your API URL

---

## Option 4: Docker (Advanced)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY bot/package*.json ./bot/
COPY engine/package*.json ./engine/
COPY web/package*.json ./web/
COPY ui/package*.json ./ui/

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build
RUN npm run build

# Expose ports
EXPOSE 3001 3000

# Start script
CMD ["sh", "-c", "node bot/dist/index.js & node web/dist/index.js & wait"]
```

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  discobot:
    build: .
    ports:
      - "3001:3001"
    env_file:
      - .env
    restart: unless-stopped
    volumes:
      - ./samples:/app/samples

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./ui/dist:/usr/share/nginx/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - discobot
    restart: unless-stopped
```

Deploy:
```bash
docker-compose up -d
```

---

## Option 5: Self-Hosted (Home Server)

**Best for**: Learning, development  
**Cost**: Electricity  
**Difficulty**: Medium

### Requirements
- Computer running 24/7 (Raspberry Pi, old PC, etc.)
- Dynamic DNS service (if no static IP)
- Port forwarding on your router

### Setup

1. **Install Ubuntu Server** or use existing Linux system
2. **Follow VPS setup** (Option 1) but on your machine
3. **Setup Dynamic DNS**:
   - Use service like DuckDNS, No-IP, or Cloudflare
   - Install updater to keep IP current
4. **Port Forward** on router:
   - Forward ports 80, 443 to your server
5. **Optional**: Use Cloudflare Tunnel to avoid port forwarding

---

## Environment Variables for Production

Update your `.env` for production:

```bash
# Discord
DISCORD_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id

# Server (adjust for your setup)
# Railway injects PORT automatically in production.
PORT=3001
NODE_ENV=production

# URLs (update these!)
WEB_API_URL=https://api.your-domain.com
WS_URL=wss://api.your-domain.com/ws/bot

# Optional: Database (when you add persistence)
DATABASE_URL=postgresql://user:pass@localhost:5432/discobot
```

---

## UI Configuration for Production

Set build-time UI environment variables:

```typescript
VITE_API_BASE_URL=https://your-domain.com/api
VITE_WS_URL=wss://your-domain.com/ws
```

Create `ui/.env.production`:
```bash
VITE_API_BASE_URL=https://your-domain.com/api
VITE_WS_URL=wss://your-domain.com/ws
```

---

## Monitoring & Maintenance

### Health Checks

Add to `web/src/index.ts`:
```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});
```

### Logging

Use PM2 logs:
```bash
pm2 logs --lines 100
pm2 logs web-server
pm2 logs discord-bot
```

Or use logging service:
- Papertrail
- Loggly
- Datadog

### Monitoring Services

- **UptimeRobot**: Free uptime monitoring
- **BetterStack**: Modern monitoring
- **PM2 Plus**: PM2 monitoring dashboard

---

## Cost Breakdown

| Platform | Free Tier | Paid | Notes |
|----------|-----------|------|-------|
| **DigitalOcean** | $200 credit | $6/mo | Droplet + bandwidth |
| **Linode** | $100 credit | $5/mo | Reliable, simple |
| **Railway** | $5 credit | $5-10/mo | Auto-scaling |
| **Render** | Yes (limited) | $7/mo | Spins down on free |
| **AWS EC2** | 12mo free | $5-20/mo | Complex pricing |
| **Heroku** | No | $7/mo | Easy but expensive |
| **Self-hosted** | Free | Electricity | DIY |

---

## Recommended: Start with Railway or Render

**Easiest path**:
1. Start with Railway (free tier)
2. Test everything works
3. If you need more control, move to VPS later

**For production/serious use**:
1. Get VPS (DigitalOcean $6/mo)
2. Setup with PM2 + nginx (follow Option 1)
3. Use Cloudflare for CDN + DDoS protection

---

## Troubleshooting

### Bot won't start
- Check Discord token in environment variables
- Check PM2 logs: `pm2 logs discord-bot`
- Verify intents enabled in Discord Developer Portal

### WebSocket won't connect
- Check nginx WebSocket proxy configuration
- Verify websocket proxy points to `localhost:3001/ws`
- Check browser console for CORS errors

### UI can't reach API
- Verify API_URL in UI build
- Check nginx proxy configuration
- Test API directly: `curl https://your-domain.com/api/health`

### High memory usage
- High polyphony and stacked effects can be memory-intensive
- Consider limiting polyphony
- Use server with 2GB+ RAM for production

---

## Security Checklist

- [ ] Never commit `.env` file
- [ ] Use HTTPS (SSL certificate)
- [ ] Setup firewall (ufw on VPS)
- [ ] Keep Node.js updated
- [ ] Use strong passwords
- [ ] Restrict SSH to key-only
- [x] Rate limit API endpoints
- [ ] Setup automatic backups
- [ ] Monitor error logs
- [ ] Use environment variables for secrets

---

## Next Steps After Deployment

1. **Setup monitoring**: UptimeRobot for health checks
2. **Add database**: PostgreSQL for pattern persistence
3. **Setup backups**: Automated daily backups
4. **Harden auth mode**: Use strict auth secrets in production
5. **CDN**: Use Cloudflare for static assets
6. **Analytics**: Track usage (optional)

Need help with a specific platform? Let me know!

<!-- AUTO_PR_CHANGELOG_START -->
### PR #56: Add LFO tempo sync, stereo spread, drum velocity per step, envelope v…

Source branch: `feat/effects-mixer-improvements`
Last sync: 2026-07-18T19:08:07.568Z

#### Changed files
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+9/-2)
- `engine/src/StreamingSynth.ts` — MODIFIED (+47/-11)
- `engine/src/Synthesizer.ts` — MODIFIED (+52/-4)
- `engine/src/types.ts` — MODIFIED (+5/-0)
- `ui/public/synth-processor.js` — MODIFIED (+17/-7)
- `ui/src/App.css` — MODIFIED (+40/-0)
- `ui/src/App.tsx` — MODIFIED (+146/-6)
- `ui/src/components/DrumMachine.css` — MODIFIED (+41/-0)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+91/-8)
- `ui/src/components/EffectsPanel.tsx` — MODIFIED (+0/-8)
- `ui/src/components/MixerPanel.css` — ADDED (+248/-0)
- `ui/src/components/MixerPanel.tsx` — ADDED (+196/-0)
- `ui/src/components/Sequencer.css` — MODIFIED (+12/-0)
- `ui/src/components/Sequencer.tsx` — MODIFIED (+6/-0)
- `ui/src/components/SynthControls.css` — MODIFIED (+48/-0)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+92/-24)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+4/-2)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+16/-6)
- `web/src/index.ts` — MODIFIED (+174/-11)
<!-- AUTO_PR_CHANGELOG_END -->
