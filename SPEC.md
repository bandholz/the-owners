# Operators: The Owners Scheduler: One-Page Spec (v1.1, approved by Eric Nov 5 2026)

## Changelog
- **v1.1 (Nov 5 2026):** Eric decisions — keep Access, app invite list, and Google test users in sync (app list is source of truth; Access auto-sync; Google test users shown as add/remove checklist because no API). Add `calendar.calendarlist.readonly` + calendar picker (default primary; store ids/names only). Guests may find times without connecting a calendar and only see free/busy for people they select (enforced server-side). v1 groups are simple saved groups (create/rename/delete, members, pick when finding times).
- **v1.0 (Nov 5 2026):** Initial approved one-page spec.

## Problem
A new podcast, Operators: The Owners, has five busy hosts and one or two producers. Finding a recording time that works for the required people is slow and manual.

## Users (invite-only)
- Hosts: Michael Techu, Andrea Nusete Elliott, Eric Bandholz, Paul Hadigee, Will Roman (Chisos)
- Producer: Aaron Orndorff (Operators Network)
- Additional producers: likely, count unknown
- Guests: invited role; can find times without connecting a calendar; only see free/busy for the people they select
- Admin: Eric (invites and removes people; can make others admins)

**Design requirement: add people without rebuilding.** The roster is data, not code. Any admin can invite a new person by email from the admin page and give them a role (host, producer, guest, admin). No fixed limit on seven; the model supports any number of people and simple saved groups (e.g. "All hosts", "Production team") for quick selection. Removing someone revokes access and deletes their stored data.

## Core features (v1)
1. Google sign-in, invite-only. Login is refused unless an admin invited that exact email. No public sign-up page.
2. Calendar connect. Hosts/producers/admins (anyone who needs their busy time considered) connect Google Calendar with `calendar.freebusy` + `calendar.calendarlist.readonly`, then pick which calendars count (default: primary). Guests are not required to connect.
3. Find a time. Choose required people and/or a saved group, date range, meeting length and daily window. The app lists open slots in Central Time (America/Chicago). Producers in other zones still see and pick slots in Central. Guests may run find-a-time without their own calendar.
4. Admin page. Invite, remove, connection status, Access sync status, and a **Google test users to add/remove** checklist (manual; no Google API for test users).
5. Saved groups. Create, rename, delete; add/remove members; pick a group when finding times.
6. Disconnect and delete. Any user can revoke access and delete their data in one click.

Later (not v1): optional attendees, holding a slot on everyone's calendar with a Meet link, recurring recording blocks, per-person preferred hours.

## Allowlists (three, kept in sync)
1. **App invite list (D1)** — source of truth for who may sign in and their role.
2. **Cloudflare Access** — updated from the app list when invites change (auto-sync when Access API token is configured; inactive until then).
3. **Google OAuth test users** — no public API; admin UI/docs show emails to add or remove in the Google Cloud console so Testing-mode consent stays aligned.

## Privacy and security
- Google scopes: `calendar.freebusy` and `calendar.calendarlist.readonly` (busy blocks + calendar names/ids only; no event titles, attendees or details). No event data stored; free/busy fetched on demand. Selected calendar ids and display names only.
- Refresh tokens encrypted at rest; secrets only in the platform secret store, never in the repo.
- Cloudflare Access in front of the whole app as a second gate, synced to the invite list.
- HTTP-only secure session cookies, CSRF protection, rate limiting, audit log of sign-ins and invites.
- Google OAuth app stays in testing mode (100-user cap) unless verification becomes necessary. Consent screen: **External**.
- Security review before anyone connects a real calendar.

## Stack
Cloudflare Workers + D1 database, behind Cloudflare Access. Built by Slattery.

## Repo, releases and backups
- Repo: private GitHub repo under the bandholz org (e.g. `bandholz/the-owners`). Only Eric and Slattery's build access; branch protection on `main`.
- Branching: `main` is always deployable and is what production runs. Work happens on short-lived feature branches merged by pull request, with automated tests and a secret scan required to pass.
- Environments: pull requests deploy to a private preview; merges to `main` deploy to staging; production deploys only from a release tag.
- Release tagging: semantic versions (`v0.1.0`, `v1.0.0`) with GitHub release notes listing changes. Rolling back means redeploying the previous tag.
- Backups: code lives in GitHub, plus a nightly mirror into the existing `bandholz/grok-bot-backup` routine. The D1 database gets a nightly export kept 30 days (Cloudflare's point-in-time restore covers recent changes). Encrypted tokens are not worth restoring; users simply reconnect.
- Secrets: never committed; GitHub secret scanning and Dependabot alerts turned on.

## Decided
- Name: Operators: The Owners (app: Operators: The Owners Scheduler).
- Time zone: Central Time (America/Chicago) default.
- Calendars: Google Calendar for everyone (assumption; revisit only if needed).
- Additional producers: added anytime via invites, no rebuild.
- Three allowlists stay in sync; app list is source of truth.
- `calendar.calendarlist.readonly` + picker; default primary.
- Guests find times without connecting a calendar.
- v1 groups: simple saved groups only.

## Open items
None for product decisions above. Still blocked on Eric checklist items (repo, GCP client, Access enable, token scopes) before staging.

## Success criteria
An invited user can sign in and within seconds see correct shared free slots for any chosen subset of people (guests without connecting a calendar). An uninvited user can't reach the site at all. Access and Google test-user checklists stay aligned with the invite list.
