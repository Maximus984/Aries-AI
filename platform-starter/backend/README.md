# Developer API Starter

## Quick Start

1. Copy env:

```bash
cp .env.example .env
```

2. Install and run:

```bash
npm install
npm run dev
```

3. Apply schema to PostgreSQL:

```bash
psql "$DATABASE_URL" -f src/db/schema.sql
```

## Endpoints

- `GET /api/health`
- `POST /api/developer/keys` (starter key creation route)
- `POST /api/generate` (requires `x-api-key`)

## Notes

- API keys are stored as SHA-256 hashes only.
- Per-key rate limiting is enforced in middleware.
- Usage logs store token counts for quota + billing.
- Plan fields are `free | pro | enterprise` for Stripe-ready upgrade workflows.
