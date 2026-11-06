export function htmlPage(title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
    h1 { font-size: 1.4rem; }
    .muted { opacity: 0.7; font-size: 0.9rem; }
    a.button, button {
      display: inline-block; margin-top: 1rem; padding: 0.55rem 0.9rem;
      border: 1px solid currentColor; border-radius: 6px; background: transparent;
      color: inherit; text-decoration: none; cursor: pointer;
    }
    .error { color: #b00020; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function homePage(opts: {
  appName: string;
  signedIn: boolean;
  email?: string;
  role?: string;
  calendarOk?: boolean;
  isGuest?: boolean;
}): Response {
  if (!opts.signedIn) {
    return htmlPage(
      opts.appName,
      `<h1>${escapeHtml(opts.appName)}</h1>
       <p>Invite-only. Sign in with the Google account an admin invited.</p>
       <p class="muted">All times shown in Central Time (America/Chicago).</p>
       <a class="button" href="/auth/google/start">Sign in with Google</a>`,
    );
  }
  const guestNote = opts.isGuest
    ? `<p class="muted">Guest: you can find times without connecting a calendar.</p>
       <p><a class="button" href="/app">Find a time</a></p>`
    : opts.calendarOk
      ? `<p><a class="button" href="/app">Find a time</a> · <a href="/calendars">Calendars</a></p>`
      : `<p><a class="button" href="/auth/google/calendar/start">Connect Google Calendar</a></p>`;

  return htmlPage(
    opts.appName,
    `<h1>${escapeHtml(opts.appName)}</h1>
     <p>Signed in as <strong>${escapeHtml(opts.email ?? "")}</strong> (${escapeHtml(opts.role ?? "")}).</p>
     <p class="muted">Calendar: ${
       opts.isGuest
         ? "not required"
         : opts.calendarOk
           ? "connected"
           : "not connected"
     }</p>
     ${guestNote}
     <p><a href="/auth/logout">Sign out</a> · <a href="/me/delete">Disconnect &amp; delete my data</a></p>
     ${opts.role === "admin" ? `<p><a href="/admin">Admin</a></p>` : ""}`,
  );
}
