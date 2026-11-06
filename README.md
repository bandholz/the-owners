# Operators: The Owners Scheduler

Invite-only shared free/busy finder for the podcast *Operators: The Owners*.

- Spec: [`SPEC.md`](./SPEC.md) (v1.1)
- Eric checklist: [`docs/eric-checklist.md`](./docs/eric-checklist.md)
- Plan: [`docs/implementation-plan.md`](./docs/implementation-plan.md)
- Access sync docs: [`docs/access-config.md`](./docs/access-config.md)
- Google test users: [`docs/google-test-users.md`](./docs/google-test-users.md)

## Ground rules

- Local + (later) preview/staging only until Eric approves production.
- No real host calendars until security review + Eric approval.
- Never commit secrets.
- Do not create Cloudflare D1/Access/Workers resources or deploy until Eric says so.
- No `git push` until Eric creates the repo and extends the GitHub token.

## Local

```bash
cp .dev.vars.example .dev.vars   # fill with non-prod test values
npm ci
npm run check
npm run db:migrate:local
npm run dev
```

## Stack

Cloudflare Workers + D1. Google OAuth (identity + `calendar.freebusy` + `calendar.calendarlist.readonly`). Cloudflare Access in front; invite list is source of truth for Access sync + Google test-user checklist.
