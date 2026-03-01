# Manual QA Checklist

## Seeded Accounts

1. Start app with defaults.
2. Verify these sign-ins work:
   - Founder: `founder@aries.local` / `AriesFounder!2026`
   - Admin: `admin@aries.local` / `AriesAdmin!2026`
   - Monitor: `monitor@aries.local` / `AriesMonitor!2026`

## Role Controls

1. Founder opens Admin panel and confirms ability to create `admin`, `staff`, `user`.
2. Admin confirms ability to create only `staff` and `user`.
3. Staff confirms account creation form is hidden/disabled.
4. Verify permissions panel shows allowed/denied actions for each role.

## API Keys + External Use

1. Generate an API key in Admin panel.
2. Copy key and call:
   - `POST /api/external/chat/dual`
   - with `x-aries-api-key` header
3. Confirm response returns dual-model output.
4. Revoke key and verify same request is rejected.

## Dual Provider Chat

1. Configure one lane as `github` and one lane as `gemini` in `server/.env`.
2. Send a normal prompt.
3. Confirm both cards return answers with provider/model metadata.
4. Refresh page and confirm chat history is restored.

## Guardrails and Reporting

1. Send a prohibited prompt (for example, asking how to hurt someone).
2. Confirm request is blocked and shown as a safety block in chat.
3. Open reports and confirm entry was created.
4. Admin/founder changes report status to `reviewed` and `closed`.

## Founder Terminal

1. Sign in as founder.
2. Open Admin panel terminal section.
3. Run `pwd` and confirm output appears.
4. Run a disallowed prefix command and confirm it is blocked.

## Legal Content

1. Open Terms panel and verify reporting policy + role hierarchy text.
2. Open Guidelines panel and verify disallowed categories + enforcement rules.
