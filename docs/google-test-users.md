# Google OAuth test users (manual sync)

The app invite list in D1 is the **source of truth**. Cloudflare Access is updated by code when `CF_ACCESS_SYNC_ENABLED=true` and Access secrets are set.

Google Cloud **test users** (OAuth consent screen, Testing mode) have **no public API**. Keep them aligned manually:

1. Invite or remove someone in the admin UI / `POST /api/admin/invite` or `/remove`.
2. Open **Admin → Google test users** or `GET /api/admin/google-test-users`.
3. **toAdd** — add each email in Google Cloud Console → APIs & Services → OAuth consent screen → Test users. Then `POST /api/admin/google-test-users/ack` with `{ "email": "..." }`.
4. **toRemove** — remove each email in the Google console. Then `POST /api/admin/google-test-users/unack`.

Until acked, invites still work in Access (when sync is on) and in the app, but Google may block consent for that email in Testing mode.
