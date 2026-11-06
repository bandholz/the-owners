# Operators: The Owners Scheduler — Implementation Plan (v1.1)

Prepared for Eric Bandholz. Nov 5, 2026 (America/Chicago).  
**Planning + local scaffolding only.** No Cloudflare resources created. No deploys. No production. No real users/calendars until security review and Eric's approval. Secrets never committed.

Source of truth: `/workspace/podcast-scheduler/spec.md` (v1.0, approved Nov 5 2026).

---

## 1. Concise summary

Invite-only Cloudflare Worker + D1 app that finds shared free time across Google Calendars using only `calendar.freebusy`. Google sign-in against an admin-managed email allowlist; Cloudflare Access as a second perimeter gate. Default timezone America/Chicago. Private GitHub repo under `bandholz`, protected `main`, PR previews → staging on merge → production only from semver tags. Nightly D1 export + code mirror. Existing bot secrets are insufficient or wrong-shaped for this app (see §9 and `eric-checklist.md`).

---

## 2. Architecture

```
Internet
   │
   ▼
Cloudflare Access (email allowlist / IdP policy)  ← second gate; whole hostname
   │
   ▼
Cloudflare Worker  (operators-scheduler)
   ├── Static UI (HTML/CSS/JS served by Worker)
   ├── App auth: Google OIDC (openid email profile) → session cookie
   ├── Allowlist check in D1 (exact email match)
   ├── Calendar connect: OAuth with calendar.freebusy (+ calendar.readonly list calendars if needed — see open Q)
   ├── Free/busy: on-demand Google FreeBusy API; intersect; return CT slots
   ├── Admin: invite/remove/roles/groups; connection status
   └── Disconnect/delete: revoke + wipe user rows
   │
   ▼
D1 (operators_scheduler_{preview|staging|prod})
   users, roles, groups, calendars_selected, encrypted refresh tokens,
   sessions, audit_log — NO event titles/attendees/details
```

**Environments (ground rule: preview/staging only until Eric approves production):**

| Env | Trigger | Hostname (proposed; domain TBD by Eric) | D1 |
|---|---|---|---|
| Local | `wrangler dev` | `http://localhost:8787` | local SQLite |
| Preview | PR deploy | `*.operators-scheduler-preview.<workers.dev or custom>` | preview DB (isolated) |
| Staging | merge to `main` | `scheduler-staging.<domain>` | staging DB |
| Production | semver tag only | `scheduler.<domain>` | prod DB — **not deployed in this phase** |

Proposed domain base: **`bandholz.com`** (already on CF account `d9eebda3928171a0baf30eaffb2c03be`). Alternates: operators-network domain if Eric prefers brand separation.

**Workers account notes (read-only probe, Nov 5 2026 CT):**
- Account `d9eebda3928171a0baf30eaffb2c03be`; workers subdomain `beardbrand`.
- Existing Worker: `beardbrand-voice-proxy` only.
- Zones include `bandholz.com`, `beardbrand.com`, etc.
- **Cloudflare Access is not enabled** on this account yet (API: `access.api.error.not_enabled`).
- Current `CLOUDFLARE_API_TOKEN`: verifies active; can list Workers + zones; **cannot** list D1 (`Authentication error`); **cannot** manage Access until Access is enabled and token gains Zero Trust / Access edit perms; cannot read its own token policies (`9109`).

---

## 3. Data model (D1)

No event payloads. Free/busy is fetched on demand and discarded after the response.

```
users
  id TEXT PK
  email TEXT UNIQUE NOT NULL          -- exact match, lowercased
  name TEXT
  role TEXT NOT NULL                  -- host | producer | guest | admin
  google_sub TEXT UNIQUE              -- from OIDC
  created_at, updated_at, invited_by, last_login_at
  calendar_connected_at
  token_status TEXT                   -- none | ok | expired | revoked

user_groups
  id, name UNIQUE, created_at

user_group_members
  group_id, user_id  PK

calendars_selected
  user_id, calendar_id, summary, primary INTEGER
  -- calendar_id is Google calendarId string; summary is display-only metadata Google returns in calendarList (not event data)

oauth_tokens
  user_id PK
  refresh_token_ciphertext BLOB NOT NULL
  refresh_token_iv BLOB NOT NULL
  refresh_token_tag BLOB NOT NULL    -- AES-GCM
  scopes TEXT
  updated_at

sessions
  id TEXT PK                          -- random
  user_id, created_at, expires_at
  csrf_secret TEXT
  ip_hash, ua_hash                    -- optional, hashed

invites (optional; or just insert into users with token_status=none)
  email, role, invited_by, created_at, accepted_at

audit_log
  id, at, actor_user_id, action, target_email, meta_json
  -- actions: sign_in, sign_out, invite, remove, role_change, calendar_connect,
  --          calendar_disconnect, find_slots, admin_promote
```

**Encryption:** refresh tokens encrypted with AES-256-GCM using Worker secret `TOKEN_ENCRYPTION_KEY` (32 bytes). Key only in Wrangler/CF secrets / GitHub Actions secrets — never in repo or D1 backups as plaintext rationale: backups keep ciphertext; restore of ciphertext without key is useless; on key rotation users reconnect.

**Deletion:** removing a user deletes sessions, tokens, calendars_selected, group memberships; audit rows kept with target email only (or anonymized — decide in security review).

---

## 4. Auth flow

### 4.1 Two gates (intentional overlap — different jobs)

1. **Cloudflare Access** — network perimeter. Only emails on the Access policy can hit the hostname at all. Spec: "unreachable for anyone off the allowlist."
2. **App Google sign-in + D1 allowlist** — application identity, roles, calendar OAuth, sessions.

**Ambiguity / conflict:** maintaining two allowlists (Access + D1) drifts. Plan:
- **Source of truth for app roles = D1.**
- Access policy: either (A) same email list synced manually/via API when invites change, or (B) Access allows a broader set (e.g. `@beardbrand.com` + explicit external host emails) and D1 still refuses uninvited sign-in. **Decided v1.1:** keep all three in sync; app invite list is source of truth; Access auto-sync from app list; Google test users via admin add/remove checklist.
- Resolved: sync Access on every invite/remove when configured.

### 4.2 Sign-in (app)

1. User hits `/` → Access ok → app shows "Sign in with Google" (no public signup).
2. OIDC authorize: `openid email profile` (identity only).
3. Callback: verify state/nonce; exchange code; read email (verified).
4. Lookup `users` by exact lowercased email. If missing → 403 "not invited" + audit.
5. Create session; set HTTP-only Secure SameSite=Lax cookie; CSRF token in cookie or double-submit.
6. If no calendar token → prompt connect.

### 4.3 Calendar connect (separate OAuth)

1. Authorize with `https://www.googleapis.com/auth/calendar.freebusy`.
2. May also need `calendar.calendarlist.readonly` to let users pick which calendars count — **spec says only freebusy**; listing calendars without that scope is limited. See open questions.
3. Store encrypted refresh token; save selected calendar IDs; never store free/busy bodies.

### 4.4 Google OAuth verification

- Hosts span multiple orgs (Chisos, Operators Network, personal) → consent screen must be **External**, not Internal Workspace.
- Spec wants **Testing mode (100-user cap)** until verification needed. Fine for invite-only podcast crew.
- `calendar.freebusy` is a **sensitive** scope; in Testing mode only listed test users can complete consent. All invitees must be added as Google Cloud test users (third allowlist — note the ops burden).
- **Do not reuse** the existing Voice worker Gmail OAuth client (`GOOGLE_CLIENT_ID` in bot secrets). New GCP project + Web client for this app.

---

## 5. Free/busy algorithm

Inputs: required user IDs, date range `[start, end)`, duration minutes, daily window (e.g. 09:00–17:00) interpreted in **America/Chicago**.

1. For each required user, load selected `calendar_id`s; skip or error if not connected.
2. Call Google `freeBusy.query` once per user (or batched calendars) for the range; receive busy intervals only.
3. Union busy intervals per user across their selected calendars.
4. Invert to free intervals per user; clip to each day's window in CT (handle DST via `Temporal` or a small TZ library).
5. Intersect free intervals across all required users.
6. Slide `duration` windows (e.g. 15-min steps) inside intersections; emit slots as CT ISO + display strings.
7. Cap result count (e.g. 50) and range length (e.g. 14 days) for abuse control.
8. Discard busy payloads after computing; do not write them to D1.

**Correctness tests:** DST spring/fall, all-day busy, overlapping calendars, empty selection, one user disconnected, midnight CT boundaries.

---

## 6. Security controls

| Control | Implementation |
|---|---|
| Scope minimization | `calendar.freebusy` (+ optional calendarList readonly if Eric approves) |
| No event storage | Free/busy ephemeral |
| Token encryption | AES-GCM, key in secrets store |
| Access perimeter | CF Access on all envs except local |
| Session | HTTP-only Secure cookies, rotating CSRF, short TTL + sliding |
| CSRF | Required on state-changing POSTs |
| Rate limit | Per-IP + per-user on auth, freebusy, invite (CF rate limiting rules + in-Worker counters) |
| Audit log | sign-in, invite, remove, connect/disconnect, find_slots |
| Secret scan | GitHub secret scanning + gitleaks/trufflehog in CI |
| Dependabot | On |
| Testing mode Google | Until security review + Eric says otherwise |
| Security review gate | Before any real calendar connect |
| No prod deploy | CI refuses tags/`--env production` until flag flipped |

---

## 7. CI/CD and environments

**Repo (Eric creates):** `bandholz/operators-the-owners-scheduler` (private).

**Branch protection on `main`:**
- Require PR
- Required checks: `test`, `typecheck`, `secret-scan`
- No direct push; restrict who can dismiss
- Signed commits optional

**Workflows (local files; push after Eric grants token access):**
1. `pr.yml` — install, typecheck, vitest, secret-scan; deploy preview Worker **only after** Eric enables preview + Access (gated by `DEPLOY_PREVIEWS=true` secret). Until then, checks only.
2. `main.yml` — same checks; deploy staging on merge (gated).
3. `release.yml` — on `v*.*.*` tag → production deploy (**disabled** until approval; workflow `if: false` or missing prod secrets).
4. `backup.yml` — nightly: D1 export → encrypted artifact / R2; also trigger note for `bandholz/grok-bot-backup` mirror of git.

**Ground rule encoded in CI:** production job no-ops without `ALLOW_PRODUCTION_DEPLOY=true` repository variable set by Eric after security review.

---

## 8. Backups

- **Code:** GitHub + nightly mirror into existing `bandholz/grok-bot-backup` routine (Eric/Slattery wiring after repo exists).
- **D1:** nightly `wrangler d1 export` (or API) per env; retain 30 days; store in private R2 bucket `operators-scheduler-backups` (create later — not now).
- **Tokens:** ciphertext only in export; on restore users reconnect if key differs.
- **PITR:** rely on Cloudflare D1 time travel for recent ops.

Local backup job code lives under `app/scripts/backup-d1.ts` (runs in CI when credentials exist; dry-run locally).

---

## 9. What we already have (no secret values)

| Asset | Status | Implication |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Active; Workers list + zones OK; **D1 auth fail**; Access not enabled | Need broader token or second token: D1 edit, Workers edit/deploy, Access apps edit, Account settings read |
| CF account | `d9eebda3928171a0baf30eaffb2c03be`, workers subdomain `beardbrand` | Usable; Access must be enabled in dashboard |
| `GITHUB_TOKEN` (fine-grained "Slattery Beardbrand") | Repos: `beardbrand-voice`, `beardbrand-knowledge`, (+ a few others); **cannot create** `bandholz/*` repos; org GET 404 | Eric creates repo and extends token to it |
| `GOOGLE_CLIENT_ID` / `SECRET` | Present; Voice/Gmail shaped | **Do not reuse**; Eric creates new GCP project + OAuth client |
| Spec | `/workspace/podcast-scheduler/spec.md` | Approved |
| App code | Scaffolded under `/workspace/podcast-scheduler/app` | Local git only, no push |

---

## 10. Test strategy

- **Unit:** free/busy intersect, TZ/DST windowing, AES token roundtrip, allowlist exact-match, CSRF.
- **Integration (vitest + Miniflare/Workers pool):** D1 migrations; OAuth callback with mocked Google token + userinfo + freebusy endpoints; admin invite/remove; disconnect wipes rows.
- **Manual (staging, after Access + test users):** security review checklist; then one synthetic Google account — not real host calendars until Eric approves.
- **CI gate:** all tests + secret-scan green before merge.

No tests hit real Google or real calendars in this phase.

---

## 11. Build phases (no time estimates)

**Phase 0 — Prep (Eric checklist)**  
Repo, GCP OAuth, Access enable, token scopes, domain pick. No real users.

**Phase 1 — Local skeleton (this session)**  
Worker, D1 schema/migrations, auth+session stubs, freebusy algorithm, admin API stubs, vitest mocks, Access config as docs/files, CI workflows, backup script. Local git commits. No push. No CF resources.

**Phase 2 — Preview/staging plumbing**  
After Eric: create D1 staging+preview (or let wrangler create once approved), set secrets, enable Access apps for staging/preview hostnames, wire CI deploy gates. Deploy **staging only**.

**Phase 3 — Security review**  
Threat model, pen-test lite, scope review, allowlist ops, backup restore drill. Written sign-off.

**Phase 4 — Closed beta**  
Invite Eric + 1–2 test accounts (not full host roster). Connect calendars. Validate slots.

**Phase 5 — Full invite**  
Hosts + producer. Monitoring. Still staging or carefully gated prod.

**Phase 6 — Production tag**  
Only after Eric approval + `ALLOW_PRODUCTION_DEPLOY`. Semver tag. Nightly backups verified.

---

## 12. Risks

1. **Dual allowlists** (Access + D1 + Google test users) → invite fails mysteriously. Mitigate: admin UI shows which gate failed; docs; prefer broader Access + strict D1.
2. **Scope creep on calendarList** — cannot pick calendars with freebusy alone. Mitigate: decide early (open Q).
3. **OAuth verification later** if Testing mode outgrown or Google forces it — delay risk.
4. **CF Access not enabled** — blocks perimeter until Eric clicks Enable.
5. **Token gaps** — cannot create D1/Access/deploy with current API token.
6. **GitHub token cannot create/push new repo** until extended.
7. **Reusing Voice Google client** would mix consent brands and scopes — forbidden in this plan.
8. **DST / multi-zone producers** — CT-only display may confuse; UX copy must be clear.
9. **Encrypted token backup useless without key** — document reconnect path.
10. **Preview URLs public by default** — must put Access in front of previews too.

---

## 13. Spec ambiguities / conflicts

See also open questions in the report / checklist.

1. **Access vs app Google sign-in overlap** — both required by spec; ops model underspecified.
2. **`calendar.freebusy` only vs calendar picker** — picking calendars typically needs `calendar.calendarlist.readonly`.
3. **Google consent Internal vs External** — Internal impossible for multi-org hosts; Testing + External is the fit, but creates a third allowlist (test users).
4. **Repo name** — spec says e.g. `bandholz/operators-the-owners-scheduler`; confirm.
5. **Domain** — not named in spec.
6. **Groups** — "optional groups" mentioned; UI depth for v1 unclear.
7. **Guest role** — invited but maybe no calendar? Can they run find-time?
8. **Backup mirror** — "existing `bandholz/grok-bot-backup` routine" — confirm it can take a new repo path.
9. **Workers subdomain** is `beardbrand` — fine for `*.beardbrand.workers.dev` previews, but custom hostnames on `bandholz.com` preferred for staging/prod branding.

---

## 14. Ground rules (encoded)

- Preview/staging only until Eric approves production.
- No real host calendars until security review + Eric approval.
- Never commit secrets.
- No Cloudflare resource creation in Phase 1.
- Local git only until Eric extends GitHub token / grants push.

---

## 15. Local scaffold status (Nov 5, 2026, America/Chicago)

Completed under `/workspace/podcast-scheduler/app` (local git `main` @ `baeba43`, **no remote, no push**):

- Worker entry + routes (auth, calendar connect, admin API, slots API, health)
- D1 migration `0001_init.sql`
- Free/busy intersection + America/Chicago windowing
- AES-GCM token helpers
- Vitest (19 tests, mocked Google) — all passing
- CI workflows with staging/prod deploys gated off
- Access config as docs/JSON examples only
- Backup script dry-run
- `wrangler deploy --dry-run` packaging OK (no remote deploy)
- Eric checklist: `/workspace/podcast-scheduler/eric-checklist.md`

**Not done (blocked on Eric):** GitHub repo + token scope, GCP OAuth client, Access enable, D1 create, any deploy, real calendars.

## 16. Eric decisions applied (v1.1, Nov 5 2026, America/Chicago)

| Topic | Decision | Implementation |
|---|---|---|
| Allowlists | Keep Access + app + Google test users in sync; app is SoT | `src/access/sync.ts` (inactive until Access secrets); `src/access/google-test-users.ts` + admin API/docs |
| Calendar scopes | freebusy + calendarlist.readonly + picker; default primary | `CALENDAR_SCOPES`, `/api/calendars`, store ids/names only |
| Guests | Find times without calendar; only selected people’s busy | `src/slots/resolve.ts` + `/api/slots` guards |
| Groups | Simple saved groups CRUD + pick in find-time | `/api/groups*` |

Open questions from v1.0 plan that remain: domain, repo confirm, first admin email, exact roster emails, staging resource create approval.

