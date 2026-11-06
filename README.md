# Operators: The Owners Scheduler

Invite-only shared free/busy finder for the podcast *Operators: The Owners*.

See `/workspace/podcast-scheduler/spec.md`, `../eric-checklist.md`, and `/workspace/slattery-plans/podcast-scheduler-plan.md`.

## Ground rules

- Local + (later) preview/staging only until Eric approves production.
- No real host calendars until security review + Eric approval.
- Never commit secrets.
- Do not create Cloudflare D1/Access/Workers resources or deploy from this tree until Eric says so.

## Local

```bash
cp .dev.vars.example .dev.vars   # fill with non-prod test values
npm ci
npm run check
npm run db:migrate:local
npm run dev
```

## Stack

Cloudflare Workers + D1. Google OAuth (identity + `calendar.freebusy`). Cloudflare Access in front (configured separately; see `docs/access-config.md`).
