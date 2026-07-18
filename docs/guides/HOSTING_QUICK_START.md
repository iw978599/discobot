# Hosting Quick Start

Choose your hosting method:

## 🚀 Option 1: Railway (Easiest - 5 minutes)

**Best for**: Quick deployment, no DevOps experience needed

1. Sign up at https://railway.app
2. Connect your GitHub repo
3. Click "Deploy from GitHub repo"
4. Add environment variables:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `NODE_ENV=production`
5. Railway auto-deploys on push

**Cost**: Free tier available, $5/mo after

---

## 🖥️ Option 2: VPS (Full control - 30 minutes)

**Best for**: Production use, full control

### Quick Setup (Ubuntu server):

```bash
# 1. Install dependencies
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2

# 2. Clone repo
cd /var/www
sudo git clone https://github.com/iw978599/discobot.git
cd discobot

# 3. Install & build
npm install
npm run build

# 4. Configure environment
cp .env.example .env
nano .env  # Add your Discord tokens

# 5. Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions

# 6. Setup nginx
sudo cp nginx.conf /etc/nginx/sites-available/discobot
sudo ln -s /etc/nginx/sites-available/discobot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 7. SSL (optional but recommended)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

**Providers**: DigitalOcean ($6/mo), Linode ($5/mo), Vultr ($6/mo)

---

## 🐳 Option 3: Docker (Portable - 10 minutes)

**Best for**: Easy deployment, containerization

```bash
# 1. Clone repo
git clone https://github.com/iw978599/discobot.git
cd discobot

# 2. Configure environment
cp .env.example .env
nano .env  # Add your Discord tokens

# 3. Build and run
docker-compose up -d

# 4. Check status
docker-compose ps
docker-compose logs -f
```

**Deploy on**: Any VPS with Docker, AWS ECS, Google Cloud Run

---

## ☁️ Option 4: Render (Simple - 10 minutes)

**Best for**: Simple setup, managed hosting

1. Sign up at https://render.com
2. Create "Web Service" from your GitHub repo
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm run start:prod`
5. Add environment variables in dashboard
6. Deploy!

**Cost**: Free tier (spins down), $7/mo for always-on

---

## 🏠 Option 5: Self-Hosted (DIY)

**Best for**: Learning, home server

1. Install Node.js 18+ on your machine
2. Follow VPS setup steps (without nginx if local only)
3. Optional: Setup port forwarding for external access
4. Use dynamic DNS (DuckDNS, No-IP) if no static IP

---

## Quick Comparison

| Method | Setup Time | Cost | Difficulty |
|--------|-----------|------|------------|
| Railway | 5 min | Free/$5+ | ⭐ Easy |
| Render | 10 min | Free/$7+ | ⭐ Easy |
| Docker | 10 min | VPS cost | ⭐⭐ Medium |
| VPS | 30 min | $5-10/mo | ⭐⭐ Medium |
| Self-hosted | 1 hr | Free | ⭐⭐⭐ Hard |

---

## After Deployment

### Test your deployment:

1. **Discord bot**: Type `/join` in your server
2. **Web UI**: Visit your domain/IP
3. **Health check**: `curl https://your-domain.com/api/health`

### Monitor:

- **Railway/Render**: Built-in dashboard
- **VPS**: `pm2 monit` or `pm2 logs`
- **Docker**: `docker-compose logs -f`

### Update:

- **Railway/Render**: Push to GitHub (auto-deploys)
- **VPS**: Run `./deploy.sh`
- **Docker**: `git pull && docker-compose up -d --build`

---

## Need Help?

1. Check **DEPLOYMENT.md** for detailed guides
2. Check logs: `pm2 logs` or `docker-compose logs`
3. Test health endpoint: `/api/health`
4. Verify environment variables are set

---

## Recommended Path

**First time hosting?**
→ Start with **Railway** (easiest)

**Want full control?**
→ Use **VPS** (DigitalOcean, Linode)

**Know Docker?**
→ Use **Docker Compose** (portable)

**On a budget?**
→ Try **Render free tier** or self-host

<!-- AUTO_PR_CHANGELOG_START -->
### PR #54: Feat/multi synth save layout redesign

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T15:06:55.296Z

#### Changed files
- `.opencode/agent/discobot-developer.md` — MODIFIED (+3/-12)
- `.opencode/skills/discobot-dev/SKILL.md` — MODIFIED (+3/-12)
- `AGENTS.md` — MODIFIED (+3/-12)
- `README.md` — MODIFIED (+3/-12)
- `docs/guides/DEPLOYMENT.md` — MODIFIED (+3/-12)
- `docs/guides/FEATURE_TESTING_GUIDE.md` — MODIFIED (+3/-12)
- `docs/guides/HOSTING_QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/RAILWAY_DEPLOY.md` — MODIFIED (+3/-12)
- `docs/guides/README_STREAMING.md` — MODIFIED (+3/-12)
- `docs/guides/SETUP.md` — MODIFIED (+3/-12)
- `docs/plans/AUDIO_STREAMING_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/DRUM_SAMPLE_REPLACEMENT_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_INVESTIGATION.md` — MODIFIED (+3/-12)
- `docs/plans/IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/IMPROVEMENT_IDEAS.md` — MODIFIED (+3/-12)
- `docs/plans/MIDI_CONTROLLER_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/PIANO_ROLL_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_CLONE_OPTIONS_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_REFACTOR_PLAN.md` — MODIFIED (+3/-12)
- `docs/reference/AI_DEVELOPMENT_GUIDE.md` — MODIFIED (+3/-12)
- `docs/reference/AUDIO_STREAMING_CODE.md` — MODIFIED (+3/-12)
- `docs/reports/ERROR_HANDLING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/FINAL_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/HIGH_PRIORITY_WORK_COMPLETE.md` — MODIFIED (+3/-12)
- `docs/reports/PERFORMANCE_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/PROJECT_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/REFACTORING_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/SEQUENCER_TIMING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reviews/CODE_REVIEW.md` — MODIFIED (+3/-12)
- `engine/src/types.ts` — MODIFIED (+1/-0)
- `start-ui.bat` — ADDED (+4/-0)
- `start-web.bat` — ADDED (+5/-0)
- `ui/src/App.css` — MODIFIED (+5/-6)
- `ui/src/App.tsx` — MODIFIED (+22/-21)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+19/-1)
- `ui/src/components/Keyboard.css` — MODIFIED (+2/-0)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+2/-0)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+6/-1)
- `web/src/index.ts` — MODIFIED (+3/-0)
<!-- AUTO_PR_CHANGELOG_END -->
