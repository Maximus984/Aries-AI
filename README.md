# Aries AI Command Suite

Aries is a local-first AI workspace built with React + Express.

It includes:
- Dual-lane chat responses in one turn (`Aries Quality` + `Aries Speed`)
- Aries Live (voice mode + immersive full-screen theater)
- Image Studio
- Code Lab
- Auth + role hierarchy (`founder > admin > staff > user`)
- Admin reporting + API key management for external integrations
- Guardrails, Terms, and Guidelines

Created and designed by MAXX FORGE STUDIO.

## GitHub Ready Status

This repository now includes:
- CI workflow: [ci.yml](/Users/maximus/Desktop/Aries%20AI/.github/workflows/ci.yml)
- PR template: [pull_request_template.md](/Users/maximus/Desktop/Aries%20AI/.github/pull_request_template.md)
- Issue templates: [ISSUE_TEMPLATE](/Users/maximus/Desktop/Aries%20AI/.github/ISSUE_TEMPLATE)
- Deployment guide: [GITHUB_DEPLOYMENT.md](/Users/maximus/Desktop/Aries%20AI/docs/GITHUB_DEPLOYMENT.md)

## 60-Second Beta Quickstart

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp server/.env.example server/.env
```

Optional client env for explicit API URL:

```bash
cp client/.env.example client/.env
```

3. Edit `server/.env` and set these first:

```env
PORT=3000
CLIENT_ORIGINS=http://localhost:5173
ALLOW_LAN_ORIGINS=true

GEMINI_API_KEY=your_primary_key_here
GEMINI_API_KEYS=your_primary_key_here,your_backup_key_here
```

4. Start both services:

```bash
npm run dev
```

5. Open the app:
- [http://localhost:5173](http://localhost:5173) (recommended; microphone-friendly)
- API health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Publish to GitHub

```bash
git init
git add .
git commit -m "feat: Aries website launch-ready"
git branch -M main
git remote add origin https://github.com/<your-user-or-org>/<repo-name>.git
git push -u origin main
```

Then follow [GITHUB_DEPLOYMENT.md](/Users/maximus/Desktop/Aries%20AI/docs/GITHUB_DEPLOYMENT.md) to go live.

## Exact `.env` Values You Need (Beta Baseline)

Use this baseline in [server/.env](/Users/maximus/Desktop/Aries%20AI/server/.env):

```env
PORT=3000

# CORS / origins
CLIENT_ORIGIN=http://localhost:5173
CLIENT_ORIGINS=http://localhost:5173,http://192.168.1.159:5173
ALLOW_LAN_ORIGINS=true

# Auth/session store
DATA_FILE=server/data/app-data.json
SESSION_TTL_HOURS=720

# Seeded accounts
FOUNDER_EMAIL=founder@aries.local
FOUNDER_PASSWORD=AriesFounder!2026
ADMIN_EMAIL=admin@aries.local
ADMIN_PASSWORD=AriesAdmin!2026
MONITOR_EMAIL=monitor@aries.local
MONITOR_PASSWORD=AriesMonitor!2026

# Request and founder terminal controls
REQUEST_TIMEOUT_MS=30000
FOUNDER_TERMINAL_CWD=.
FOUNDER_TERMINAL_TIMEOUT_MS=30000
FOUNDER_TERMINAL_ALLOWED_PREFIXES=pwd,ls,cd,cat,rg,sed,find,head,tail,wc,echo,touch,mkdir,cp,mv,npm,node,npx,git

# GitHub Models (optional provider lane)
GITHUB_TOKEN=
GITHUB_MODELS_BASE_URL=https://models.inference.ai.azure.com

# Gemini (active provider)
GEMINI_API_KEY=your_primary_key_here
GEMINI_API_KEYS=your_primary_key_here,your_backup_key_here
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta/models
GEMINI_IMAGE_MODEL=gemini-2.0-flash-preview-image-generation
GEMINI_IMAGE_TIMEOUT_MS=60000

# Optional premium live voices
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=OYTbf65OHHFELVut7v2H
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_BASE_URL=https://api.elevenlabs.io/v1
ELEVENLABS_VOICE_OPTIONS=OYTbf65OHHFELVut7v2H|Aries Signature|Balanced and natural,EXAVITQu4vr4xnSDxMaL|Aries Storyteller|Warm and expressive

# Lane config (Gemini defaults)
LANE_PRO_PROVIDER=gemini
LANE_PRO_MODEL=gemini-2.5-pro
LANE_PRO_LABEL="Aries Quality"
LANE_FLASH_PROVIDER=gemini
LANE_FLASH_MODEL=gemini-2.5-flash
LANE_FLASH_LABEL="Aries Speed"
```

## Run Commands

- Start full stack: `npm run dev`
- Start server only: `npm run dev:server`
- Start client only: `npm run dev:client`
- Run tests: `npm run test`
- Build all: `npm run build`

Workspace scripts:
- Client tests: `npm run test --workspace client`
- Server tests: `npm run test --workspace server`

## Default Seeded Accounts

Loaded automatically from `.env` at server boot:
- Founder: `founder@aries.local` / `AriesFounder!2026`
- Admin: `admin@aries.local` / `AriesAdmin!2026`
- Monitor (staff): `monitor@aries.local` / `AriesMonitor!2026`

## Core Endpoints

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `POST /api/chat/dual`
- `POST /api/live/tts`
- `GET /api/live/voices`
- `POST /api/media/image`
- `POST /api/reports/feedback`
- `POST /api/external/chat/dual` (requires `x-aries-api-key`)
- `POST /api/external/media/image` (requires `x-aries-api-key`)

## Fast Fixes (Mic / Live / Auth / CORS)

### 1) Mic does not work in Aries Live

Symptoms:
- “Microphone requires a secure context”
- No speech input captured

Fix:
1. Open app at `http://localhost:5173` (not LAN HTTP hostnames).
2. Use Chrome or Edge.
3. Allow microphone permissions in browser site settings.
4. Reload page after permission change.

Important:
- Browsers usually block microphone on `http://192.168.x.x:5173` unless HTTPS is used.

### 2) Live mode looks frozen / black / stuck

Fix checklist:
1. Confirm media files exist:
   - [client/public/media/aries-live-startup.mp4](/Users/maximus/Desktop/Aries%20AI/client/public/media/aries-live-startup.mp4)
   - [client/public/media/galaxy-loop.mp4](/Users/maximus/Desktop/Aries%20AI/client/public/media/galaxy-loop.mp4)
2. Hard refresh browser (`Cmd+Shift+R` on macOS).
3. Exit/re-enter Aries Live.
4. Run a production build test:
   - `npm run build --workspace client`

### 3) “Auth service unavailable”

Fix:
1. Ensure server is running on `http://localhost:3000`.
2. Verify CORS settings in `.env`:
   - `CLIENT_ORIGINS=http://localhost:5173,http://192.168.x.x:5173`
   - `ALLOW_LAN_ORIGINS=true`
3. Restart server after `.env` changes.

### 4) “Cannot GET /”

Cause:
- You opened backend URL (`:3000`) in browser root.

Fix:
- Open UI at `http://localhost:5173`.
- Backend root is API-only; use `http://localhost:3000/api/health` for health.

### 5) “Aries is temporarily unavailable”

Fix:
1. Verify at least one valid Gemini key in `.env`.
2. Use key failover:
   - `GEMINI_API_KEYS=primary,backup`
3. Restart server.
4. Check admin reports for operational incidents.

## Assets (Optional but Recommended)

Place these files:
- [client/public/media/aries-live-startup.mp4](/Users/maximus/Desktop/Aries%20AI/client/public/media/aries-live-startup.mp4)
- [client/public/media/galaxy-loop.mp4](/Users/maximus/Desktop/Aries%20AI/client/public/media/galaxy-loop.mp4)
- Logo (auto-load order):
  - [client/public/media/aries-logo.svg](/Users/maximus/Desktop/Aries%20AI/client/public/media/aries-logo.svg)
  - [client/public/media/aries-logo.png](/Users/maximus/Desktop/Aries%20AI/client/public/media/aries-logo.png)
  - [client/public/media/aries-logo.webp](/Users/maximus/Desktop/Aries%20AI/client/public/media/aries-logo.webp)

## External API Integration (Other Projects)

Generate an API key from Admin, then call:

```bash
curl -s -X POST http://localhost:3000/api/external/chat/dual \
  -H "Content-Type: application/json" \
  -H "x-aries-api-key: aries_live_..." \
  -d '{
    "sessionId": "external-session-1",
    "message": "Hello from another app",
    "history": []
  }'
```

## Beta Smoke Test Checklist

Run before inviting testers:

1. `npm run test`
2. `npm run build`
3. Verify:
   - [http://localhost:5173](http://localhost:5173) loads
   - [http://localhost:3000/api/health](http://localhost:3000/api/health) returns healthy
4. Sign in and confirm:
   - Dual-lane chat returns answers
   - Aries Live opens, voice selection works, mic works on localhost
   - Image generation returns images
   - Code Lab generates code output
   - Feedback/report entries appear in Admin

## Safety + Reporting

- Self-harm/violence prompts are blocked and reported.
- Reports are visible by role permissions in Admin dashboards.
- Guardrails also apply to external API-key calls.

## Local Python Voice Bot (Optional)

Run:

```bash
python scripts/local_voice_assistant.py
```

Dependencies include:
- `SpeechRecognition`
- `pocketsphinx`
- `TTS`
- `torch`
- `pygame`
- `webrtcvad`
- `vosk`
- `langchain`
- `langchain-community`
- `langchain-text-splitters`
- `faiss-cpu`

Install example:

```bash
pip install SpeechRecognition pocketsphinx TTS torch pygame webrtcvad vosk langchain langchain-community langchain-text-splitters faiss-cpu
```

## Security Notes

- Keep secrets in server `.env` only; never expose keys in client code.
- Rotate any API keys that were ever pasted into chat or screenshots.
- Use HTTPS for non-localhost deployments.
