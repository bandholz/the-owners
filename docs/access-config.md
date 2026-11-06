# Cloudflare Access config (docs only — do not create yet)

Access is **not enabled** on account `d9eebda3928171a0baf30eaffb2c03be` as of Nov 5, 2026 (America/Chicago). Eric must Enable Zero Trust/Access first.

## Allowlist sync (v1.1)

- **Source of truth:** D1 invite list (`users.email`).
- **Code:** `src/access/sync.ts` — on invite/remove (and `POST /api/admin/access-sync`) PUTs the Access policy `include` email selectors to match the invite list.
- **Inactive until:** `CF_ACCESS_SYNC_ENABLED=true` plus secrets `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ACCESS_APP_ID`, `CF_ACCESS_POLICY_ID` (Worker secrets / `.dev.vars`). Without these, sync returns `status: "skipped"` and does not call Cloudflare.
- **Do not** create Access apps from this repo until Eric approves.

## Recommended shape (Worker-level or hostname)

Protect staging Worker / `scheduler-staging.sovrnty.com` for all traffic + previews.

Create one Access **allow** policy whose include list will be overwritten by sync (start with Eric's admin email). Note the **application id** and **policy id** for secrets.

## IdP

Prefer Google (consumer) or Cloudflare IdP / OTP — not Workspace-only (hosts are multi-org).

## Three allowlists

1. App D1 (automatic)
2. Cloudflare Access (code sync when enabled)
3. Google test users (manual checklist — see `google-test-users.md`)
