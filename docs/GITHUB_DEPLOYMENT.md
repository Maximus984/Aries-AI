# GitHub + Production Deployment Guide

This guide gets Aries from local machine to a live public website.

## 1) Push to GitHub

From the project root:

```bash
git init
git add .
git commit -m "feat: initial Aries release"
git branch -M main
git remote add origin https://github.com/<your-org-or-user>/<repo-name>.git
git push -u origin main
```

After push:
- CI runs from [.github/workflows/ci.yml](/Users/maximus/Desktop/Aries%20AI/.github/workflows/ci.yml)
- Every PR/push must pass test + build.

## 2) Deploy Backend (Render or Railway)

Recommended service type: Web Service (Node).

Settings:
- Root directory: `.` (repo root)
- Build command: `npm ci && npm run build --workspace server`
- Start command: `npm run start --workspace server`
- Runtime: Node 20

Required environment variables (minimum):
- `NODE_ENV=production`
- `PORT=3000`
- `CLIENT_ORIGINS=https://<your-frontend-domain>`
- `ALLOW_LAN_ORIGINS=false`
- `GEMINI_API_KEY=<real-key>`
- `GEMINI_API_KEYS=<primary,backup>`
- `LANE_PRO_PROVIDER=gemini`
- `LANE_PRO_MODEL=gemini-2.5-pro`
- `LANE_FLASH_PROVIDER=gemini`
- `LANE_FLASH_MODEL=gemini-2.5-flash`

Optional:
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_VOICE_OPTIONS`

## 3) Deploy Frontend (Vercel or Netlify)

### Vercel (recommended)

Project settings:
- Framework: Vite
- Root directory: `client`
- Build command: `npm run build`
- Output directory: `dist`

Environment variable:
- `VITE_API_BASE_URL=https://<your-backend-domain>`

## 4) Connect Frontend <-> Backend

After both deploy:
1. Put your frontend URL into backend `CLIENT_ORIGINS`.
2. Redeploy backend.
3. Verify:
   - `GET https://<backend>/api/health`
   - Frontend sign-in works.
   - Chat returns responses.

## 5) Voice + Mic in Production

Microphone features need secure context:
- Production must use HTTPS.
- `localhost` is fine for local dev.
- Plain HTTP on public/LAN hosts will fail mic access in most browsers.

## 6) Pre-Launch Checklist

1. CI green on `main`.
2. No real keys committed to repo.
3. Backend `.env` is configured in host secrets panel.
4. Frontend points to deployed API via `VITE_API_BASE_URL`.
5. Founder/admin accounts tested.
6. Aries Live tested in Chrome/Edge.
7. Admin safety reporting tested.
