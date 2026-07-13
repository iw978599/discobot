# Railway Deployment Guide

## Quick Start

Railway deployment is now optimized with a dedicated `Dockerfile.railway` that removes nginx (Railway handles routing).

### 1. Push Your Changes

```bash
git add .
git commit -m "fix: Railway deployment configuration"
git push
```

### 2. Railway Environment Variables

Set these in your Railway project dashboard:

```bash
# Required
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id

# Railway provides PORT automatically - DO NOT SET IT
# The app will use Railway's $PORT variable

# Optional but recommended for explicit browser origin allow-list
ALLOWED_ORIGINS=https://your-app-name.up.railway.app

# Optional: Set NODE_ENV
NODE_ENV=production

# Optional explicit URLs
PUBLIC_URL=https://your-app-name.up.railway.app
UI_URL=https://your-app-name.up.railway.app
WS_URL=wss://your-app-name.up.railway.app/ws/bot
```

### 3. Railway Configuration

The `railway.json` file tells Railway to use `Dockerfile.railway`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile.railway"
  }
}
```

### 4. How It Works

1. **Single Port**: Railway gives you one public HTTPS endpoint
2. **WebSocket**: Available at `https://your-app.railway.app/ws`
3. **API**: Available at `https://your-app.railway.app/api/*`
4. **Static UI**: Served from `/` (React app)
5. **Health Check**: Available at `https://your-app.railway.app/health`

### 5. Connecting the UI

Your React app needs to know the Railway URL. You have two options:

#### Option A: Environment Variable (Recommended)

In Railway dashboard, add:
```bash
PUBLIC_URL=https://your-app-name.up.railway.app
```

Then update `ui/src/hooks/useWebSocket.ts` to use:
```typescript
const wsUrl = import.meta.env.VITE_WS_URL || 
              (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + 
              window.location.host + '/ws';
```

#### Option B: Auto-detect (Easier)

The UI can auto-detect the WebSocket URL from the browser:
```typescript
// In ui/src/hooks/useWebSocket.ts
const getWebSocketUrl = () => {
  // In production, use same host as the page
  if (import.meta.env.PROD) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  // In development, use localhost
  return 'ws://localhost:3001/ws';
};
```

### 6. Deployment Checklist

- [ ] Push code with Railway fixes
- [ ] Set `DISCORD_TOKEN` in Railway dashboard
- [ ] Set `DISCORD_CLIENT_ID` in Railway dashboard
- [ ] DO NOT set `WEB_PORT` or `PORT` (Railway provides it)
- [ ] Wait for Railway to build (check logs)
- [ ] Test health endpoint: `https://your-app.railway.app/health`
- [ ] Test WebSocket: Open browser console at `https://your-app.railway.app`
- [ ] Invite Discord bot to server and test commands

## Troubleshooting

### 502 Bad Gateway

**Problem**: Railway can't connect to your app

**Solutions**:
1. Check the app is listening on `0.0.0.0:$PORT` (not `localhost`)
2. Verify `PORT` env var is NOT set (Railway provides it)
3. Check Railway logs for startup errors
4. Verify health check passes: `/health`

### WebSocket Connection Refused

**Problem**: Browser can't connect to WebSocket

**Solutions**:
1. Use `wss://` protocol (not `ws://`) for HTTPS
2. Connect to `/ws` path on same domain
3. Check browser console for connection errors
4. Verify Railway deployment is running

### Discord Bot Not Responding

**Problem**: Bot online but doesn't respond to commands

**Solutions**:
1. Check `DISCORD_TOKEN` is correct
2. Verify bot has required intents (Server Members, Message Content)
3. Check Railway logs for errors
4. Test bot locally first to isolate Railway issues

### Build Fails

**Problem**: Railway build errors

**Solutions**:
1. Check `Dockerfile.railway` exists
2. Verify `railway.json` has correct `dockerfilePath`
3. Look for TypeScript compilation errors in logs
4. Try building locally: `docker build -f Dockerfile.railway -t discobot-test .`

## Architecture

```
Railway Public URL (HTTPS)
         │
         ├─ / → Static React App (ui/dist)
         ├─ /api/* → Express Server (web/dist)
         ├─ /ws → WebSocket (same server)
         └─ /health → Health check
         
Internal:
  - Web Server: Node.js on PORT (Railway-provided)
  - Discord Bot: Node.js (background process)
  - Both run in same container
```

## Differences from Local Development

| Aspect | Local | Railway |
|--------|-------|---------|
| Port | 3001 (hardcoded) | $PORT (dynamic) |
| Host | localhost | 0.0.0.0 |
| Protocol | http/ws | https/wss |
| Reverse Proxy | None | Railway's edge |
| UI Serving | Vite dev server | Static files from Express |
| SSL | None | Railway provides |

## Cost

- Free tier: $5 credit/month
- Usage-based: ~$5-10/month for 24/7 bot
- Scales automatically with traffic

## Monitoring

### Check if deployed:
```bash
curl https://your-app.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 123.456,
  "timestamp": 1234567890,
  "environment": "production",
  "port": 3001
}
```

### View logs:
1. Go to Railway dashboard
2. Click your project
3. Click "View Logs"
4. Look for startup messages

### Test WebSocket:
Open browser console at your Railway URL:
```javascript
const ws = new WebSocket('wss://your-app.railway.app/ws');
ws.onopen = () => console.log('Connected!');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.onerror = (e) => console.error('Error:', e);
```

## Next Steps

1. **Custom Domain**: Add in Railway dashboard → Settings → Domains
2. **Database**: Add PostgreSQL service for pattern persistence
3. **Redis**: Add Redis for caching/sessions if needed
4. **Monitoring**: Add Sentry or LogRocket for error tracking
5. **Analytics**: Add Plausible or Simple Analytics

## Rollback

If deployment fails, Railway keeps previous version running. You can:

1. **Rollback in UI**: Railway dashboard → Deployments → "..." → Rollback
2. **Revert Git**: `git revert HEAD` and push
3. **Check logs**: Always check logs before/after deploy

## Getting Help

- Railway Discord: https://discord.gg/railway
- Railway Docs: https://docs.railway.app
- This repo issues: https://github.com/iw978599/discobot/issues
