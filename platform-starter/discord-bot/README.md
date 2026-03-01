# Aries Discord Bot Starter

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Slash Commands

- `/generate`
- `/fix`
- `/explain`

## Notes

- Set `REGISTER_SLASH_COMMANDS=true` on first run.
- Bot forwards prompts to your Aries backend at `ARIES_API_BASE_URL`.
- Responses are truncated safely to fit Discord limits.
