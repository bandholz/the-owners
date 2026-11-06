# Cloudflare Access config (docs only — do not create yet)

Access is **not enabled** on account `d9eebda3928171a0baf30eaffb2c03be` as of Nov 5, 2026 (America/Chicago). Eric must Enable Zero Trust/Access first.

## Recommended shape (Worker-level)

Protect the `operators-scheduler` Worker (staging first) for **all traffic + previews**.

Pseudo API body (do not POST until Eric approves):

```json
{
  "type": "self_hosted",
  "name": "operators-scheduler-staging",
  "destinations": [
    { "type": "worker", "worker_id": "REPLACE_AFTER_CREATE" }
  ],
  "policies": [
    {
      "name": "invited podcast crew",
      "decision": "allow",
      "include": [
        { "email": { "email": "ERIC_ADMIN_EMAIL" } },
        { "email": { "email": "host1@..." } }
      ]
    }
  ],
  "session_duration": "24h"
}
```

Also add hostname-based app for `scheduler-staging.bandholz.com` if Worker-level destination is not used.

## IdP

Prefer **Google (consumer OAuth)** or **Cloudflare IdP / OTP**, not Google Workspace-only — hosts are multi-org.

## Overlap with app Google sign-in

- Access = perimeter (can you hit the hostname?).
- App OIDC + D1 allowlist = identity + roles + calendar.
- v1 recommendation: Access allowlist can be broader; D1 is source of truth for invites.

## Local wrangler Access simulation (optional later)

```jsonc
"access": {
  "dev": {
    "aud": "operators-scheduler-local",
    "identity": { "email": "eric@example.com" }
  }
}
```

Do not enable until local Access-aware code paths are tested.
