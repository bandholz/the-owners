# Eric checklist — Operators: The Owners Scheduler (spec v1.1)

Do these before anyone connects a real calendar. Code lives under `/workspace/podcast-scheduler/app` (local git only). Slattery will not create Cloudflare resources, push to GitHub, or deploy until you finish the blockers below and say go on staging.

Ground rules: preview/staging only; no production; no real host calendars until security review + your approval; never put secrets in the repo.

---

## 0. Decisions (resolved Nov 5 2026)

- [x] **Allowlists:** keep Access, app invite list, and Google test users in sync. **App list is source of truth.** Access auto-syncs from invites when token/app/policy are configured. Google test users = admin **to add / to remove** checklist (no Google API).
- [x] **Calendar scopes:** `calendar.freebusy` **and** `calendar.calendarlist.readonly` + picker (default primary; store ids/names only).
- [x] **Guests:** can find times without connecting a calendar; only see free/busy for people they select (server-enforced).
- [x] **Groups:** v1 simple saved groups (create/rename/delete, members, pick when finding times).

Still pick:

- [ ] **Domain base.** Proposed: `sovrnty.com` → `scheduler-staging.sovrnty.com` / `scheduler.sovrnty.com` (+ Workers previews on `beardbrand` behind Access).
- [ ] **Repo name.** Proposed: `bandholz/operators-the-owners-scheduler`.
- [ ] **First admin email** (exact Google account for seed admin).

---

## 1. Google Cloud project + Calendar API

- [ ] Create a **new** GCP project, e.g. `operators-owners-scheduler` (do **not** reuse Voice/Gmail or bot `GOOGLE_CLIENT_*`).
- [ ] Enable **Google Calendar API**.

---

## 2. OAuth consent screen

- [ ] User type: **External**
- [ ] Publishing status: **Testing** (100-user cap)
- [ ] App name: `Operators: The Owners Scheduler`
- [ ] Support + developer contact: your email
- [ ] Scopes (required):
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `https://www.googleapis.com/auth/calendar.freebusy` (**sensitive**)
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (**sensitive** / restricted depending on Google’s current classification — needed for picker)
- [ ] **Test users:** add every invitee while in Testing mode. After each admin invite, use the app’s **Google test users to add/remove** list (`GET /api/admin/google-test-users`) and ack after you update the console.

---

## 3. OAuth client (Web application)

- [ ] Type **Web application**, name `operators-scheduler-web`
- [ ] **Authorized JavaScript origins:**
  - `http://localhost:8787`
  - `https://scheduler-staging.sovrnty.com` *(or your domain)*
  - `https://scheduler.sovrnty.com` *(prod later)*
  - Preview origins when known
- [ ] **Authorized redirect URIs:**
  - `http://localhost:8787/auth/google/callback`
  - `http://localhost:8787/auth/google/calendar/callback`
  - `https://scheduler-staging.sovrnty.com/auth/google/callback`
  - `https://scheduler-staging.sovrnty.com/auth/google/calendar/callback`
  - Production + preview pairs when ready
- [ ] Give Client ID/Secret via Grok Bot **secret-request** as `SCHEDULER_GOOGLE_CLIENT_ID` / `SCHEDULER_GOOGLE_CLIENT_SECRET` — do not overwrite Voice secrets; do not paste into Slack.

---

## 4. Test users (Google) — ongoing

- [ ] Add yourself + Slattery synthetic test account first.
- [ ] After every invite/remove: follow admin **toAdd / toRemove**, then ack/unack in the app.

---

## 5. GitHub repo + token access

- [ ] Create private **`bandholz/operators-the-owners-scheduler`**
- [ ] Branch protection on `main`: PR required; checks `test`, `typecheck`, `secret-scan`; secret scanning + Dependabot on
- [ ] Extend fine-grained token **“Slattery Beardbrand”** to this repo (Contents/PRs/Workflows/Actions as needed). Current token cannot create or access it.
- [ ] Wire `bandholz/grok-bot-backup` mirror after first push.

---

## 6. Cloudflare Access + API token gaps

Account `d9eebda3928171a0baf30eaffb2c03be` (workers subdomain `beardbrand`).

- [ ] **Enable Zero Trust / Access** (API today: not enabled).
- [ ] DNS for staging hostname when domain confirmed.
- [ ] Widen `CLOUDFLARE_API_TOKEN` (or add scheduler token): Workers Edit, **D1 Edit**, **Access apps/policies Edit**, Account read, optional DNS on `sovrnty.com`, optional R2 for backups. Current token: Workers/zones OK; **D1 fail**; Access not enabled.
- [ ] After Access app + allow policy exist: give Slattery `CF_ACCESS_APP_ID` + `CF_ACCESS_POLICY_ID` (and token) so invite sync can be turned on with `CF_ACCESS_SYNC_ENABLED=true`. Until then sync stays **skipped** in code.
- [ ] Approve **staging** D1/Worker/Access create explicitly before any create/deploy.

---

## 7. Next approvals (order)

1. Staging resources (still no prod)  
2. Security review  
3. Synthetic calendar connect  
4. Real invites + Google test-user checklist discipline  
5. Production only with `ALLOW_PRODUCTION_DEPLOY` + your OK  

---

## 8. Seed roster (emails still needed)

Hosts: Michael Techu, Andrea Nusete Elliott, Eric Bandholz, Paul Hadigee, Will Roman (Chisos).  
Producer: Aaron Orndorff (Operators Network).  
Admin: Eric.
