# Aries AI Platform Launch Roadmap

## 1. Architecture Overview

- Frontend: React + Vite web app (PWA-enabled), Aries chat/live UX.
- Core API: Node.js + Express backend with OpenAI/Gemini provider adapters.
- Developer API Platform: API-key auth, per-key rate limiting, usage metering, plan tiers.
- Integrations: VS Code extension and Discord bot call backend API (never direct model keys).
- Data layer: PostgreSQL (`users`, `api_keys`, `usage_logs`) with token/quota tracking.
- Ops: HTTPS, CORS allowlist, Helmet, request validation, monitoring.

## 2. Backend Implementation

Starter code is in:
- `/Users/maximus/Desktop/Aries AI/platform-starter/backend`

Included:
- Express server bootstrap with `helmet`, CORS allowlist, global rate limit
- API key auth middleware (`x-api-key`)
- Per-key rate limiter middleware
- Protected route: `POST /api/generate`
- Token usage logging and quota checks
- Starter key generation route: `POST /api/developer/keys`
- SQL schema:
  - `/Users/maximus/Desktop/Aries AI/platform-starter/backend/src/db/schema.sql`

## 3. API Key System

- Secure storage: SHA-256 hashed keys only.
- Metadata: key prefix, `rpm_limit`, active/revoked state, usage timestamps.
- Usage logs: prompt/completion/total tokens per request.
- Quota strategy:
  - Free: low `monthly_token_quota` + lower RPM
  - Pro: higher quota and RPM
  - Enterprise: custom SLA/limits
- Upgrade path: map Stripe subscription status to `users.plan_tier` and `plan_status`.

## 4. Discord Bot

Starter code is in:
- `/Users/maximus/Desktop/Aries AI/platform-starter/discord-bot`

Included:
- discord.js v14 bot
- slash commands: `/generate`, `/fix`, `/explain`
- backend API forwarding with `x-api-key`
- per-user cooldown to reduce spam
- safe truncation for long responses
- command registration flow

## 5. VS Code Extension

Starter code is in:
- `/Users/maximus/Desktop/Aries AI/platform-starter/vscode-extension`

Included:
- TypeScript extension (`extension.ts`)
- commands:
  - `Aries: Generate Code`
  - `Aries: Explain Code`
  - `Aries: Fix Code`
- inserts output into active editor
- Axios API calls + error handling
- extension settings for API base URL, key, model

## 6. PWA Setup

Implemented in current client:
- Manifest: `/Users/maximus/Desktop/Aries AI/client/public/manifest.json`
- Service worker: `/Users/maximus/Desktop/Aries AI/client/public/sw.js`
- Offline fallback: `/Users/maximus/Desktop/Aries AI/client/public/offline.html`
- SW registration: `/Users/maximus/Desktop/Aries AI/client/src/main.tsx`
- Manifest link and theme color: `/Users/maximus/Desktop/Aries AI/client/index.html`

## 7. Security Checklist

- Enforce HTTPS in production (TLS termination at load balancer/CDN).
- Keep model/vendor keys server-side only (`.env`, secret manager).
- Helmet enabled for secure headers.
- CORS allowlist by environment.
- Validate and sanitize request payloads (`zod` + string cleanup).
- Global + per-key rate limiting.
- Quota enforcement to prevent token exhaustion.
- Sandbox any user code execution (containers, CPU/memory/time/network limits).
- Add audit logging + anomaly alerts.

## 8. Deployment Guide

1. Provision Postgres.
2. Apply SQL schema.
3. Set env vars (`OPENAI_API_KEY`, `DATABASE_URL`, allowed origins, limits).
4. Deploy backend on HTTPS domain.
5. Deploy frontend (Vite build output) on CDN/edge.
6. Point VS Code extension and Discord bot to backend base URL.
7. Enable monitoring + alerting.

## 9. Recommended Hosting Stack

- Frontend: Cloudflare Pages / Vercel / Netlify.
- Backend API: Fly.io / Render / Railway / AWS ECS.
- Database: Neon / Supabase Postgres / AWS RDS.
- Edge protection: Cloudflare WAF + rate limiting.
- Monitoring: Sentry + OpenTelemetry + Grafana/Datadog.

## 10. Monetization Readiness

- Plan tiers already modeled in `users.plan_tier`.
- Usage logs already capture token economics.
- Add Stripe webhooks:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- On webhook, update `plan_tier`, `plan_status`, and quotas.
- Enforce quota checks at request-time to gate paid access.
