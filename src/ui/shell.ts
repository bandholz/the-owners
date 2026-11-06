import { clientScript } from "./client";
import { roleLabel } from "./time";

export interface Viewer {
  appName: string;
  email: string;
  name?: string | null;
  role: string;
  calendarOk: boolean;
  isGuest: boolean;
  timeZone: string;
}

export type NavKey = "home" | "calendars" | "admin";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CSS = `
:root {
  color-scheme: light;
  --sidebar: #1a1a1a;
  --sidebar-elev: #242424;
  --sidebar-active: #303030;
  --sidebar-text: #f3f3f3;
  --sidebar-muted: #b5b5b5;
  --sidebar-line: rgba(255, 255, 255, 0.08);
  --canvas: #f1f1f1;
  --card: #ffffff;
  --text: #1a1a1a;
  --muted: #616161;
  --line: #e3e3e3;
  --line-strong: #c9cccf;
  --ok: #0b7a32;
  --ok-bg: #e7f6ec;
  --warn: #8a6116;
  --warn-bg: #fff4e0;
  --bad: #8e1f0b;
  --bad-bg: #fdecea;
  --focus: #005bd3;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--canvas);
  color: var(--text);
  font-size: 14px;
  line-height: 1.45;
  min-height: 100vh;
}
button, input, select { font: inherit; color: inherit; }
a { color: inherit; }
.skip {
  position: absolute;
  left: 12px;
  top: -40px;
  background: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  z-index: 5;
}
.skip:focus { top: 12px; }
.app { display: flex; min-height: 100vh; align-items: stretch; }
.sidebar {
  width: 240px;
  flex: 0 0 240px;
  background: var(--sidebar);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  padding: 14px 10px 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
  padding: 4px 8px 12px;
}
.mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #303030;
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  letter-spacing: -0.03em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.brand-text { display: flex; flex-direction: column; line-height: 1.15; }
.brand-name { font-size: 14px; font-weight: 700; }
.sr-app {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.brand-sub { color: var(--sidebar-muted); font-size: 12px; margin-top: 2px; }
.icon { width: 18px; height: 18px; flex: 0 0 auto; }
.nav { display: flex; flex-direction: column; gap: 2px; padding: 0 4px; }
.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  color: #ececec;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 600;
}
.nav-link:hover { background: var(--sidebar-elev); }
.nav-link[aria-current="page"] {
  background: var(--sidebar-active);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}
.sidebar-foot {
  margin-top: auto;
  padding: 12px 8px 4px;
  border-top: 1px solid var(--sidebar-line);
}
.who { padding: 4px 6px 8px; }
.who-email {
  font-size: 12.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.who-role { color: var(--sidebar-muted); font-size: 12px; margin-top: 2px; }
.main { flex: 1; min-width: 0; }
.main-inner {
  max-width: 1080px;
  padding: 22px 32px 72px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px 24px;
  padding: 6px 2px 8px;
}
.metrics-tight { margin-top: 4px; }
.metric-label {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.metric-value {
  margin-top: 3px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.status { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8a8a8a;
  display: inline-block;
}
.dot-ok { background: var(--ok); }
.dot-warn { background: #b98900; }
.hero { text-align: center; padding: 34px 12px 4px; }
.hero h1, .page-head h1, .public-card h1 {
  font-size: 36px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0;
}
.page-head { margin: 18px 0 18px; }
.page-head h1 { font-size: 32px; }
.lede, .hint { color: var(--muted); }
.lede { margin: 8px 0 0; font-size: 15px; }
.hint { margin: 0 0 12px; font-size: 13px; }
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 22px 0 26px;
}
.stack { display: flex; flex-direction: column; gap: 16px; }
.stack-sm { display: flex; flex-direction: column; gap: 8px; }
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 20px 22px;
}
.card h2, .subcard h3, .day-group h3, .grid-3 h3 {
  margin: 0 0 6px;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.grid-3 h3, .day-group h3 {
  font-size: 13px;
  color: var(--muted);
  font-weight: 700;
}
.card p { margin: 0 0 14px; }
.card-quiet { margin-top: 16px; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--line-strong);
  background: #fff;
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
  line-height: 1.2;
}
.btn:hover { background: #f6f6f6; }
.btn-primary {
  background: #1a1a1a;
  border-color: #1a1a1a;
  color: #fff;
}
.btn-primary:hover { background: #000; }
.btn-danger {
  color: var(--bad);
  border-color: #e7c4bc;
  background: #fff;
}
.btn-danger:hover { background: #fff6f4; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.banner {
  border-radius: 12px;
  padding: 10px 12px;
  background: #f6f6f6;
  margin: 0 0 12px;
}
.banner-ok { background: var(--ok-bg); color: var(--ok); }
.banner-bad { background: var(--bad-bg); color: var(--bad); }
.banner-warn { background: var(--warn-bg); color: var(--warn); }
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
}
.field input, .field select, .subcard input, .person select, .check-row select {
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  padding: 8px 40px 8px 10px;
  background-color: #fff;
  font-weight: 500;
}
.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  margin-bottom: 8px;
}
.form-row .field { flex: 1 1 180px; }
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.window { display: flex; align-items: center; gap: 8px; }
.window input { flex: 1; }
.to { color: var(--muted); font-weight: 500; }
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #ececec;
  border-radius: 12px;
  background: #fff;
}
.check-row:hover { border-color: #d0d0d0; }
.check-row input[type="checkbox"] { margin-top: 3px; width: 16px; height: 16px; }
.check-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.check-title { font-weight: 600; overflow-wrap: anywhere; }
.sub { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.is-disabled { opacity: 0.72; }
.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  background: #f1f1f1;
  color: #3d3d3d;
  white-space: nowrap;
}
.pill-ok { background: var(--ok-bg); color: var(--ok); }
.pill-warn { background: var(--warn-bg); color: var(--warn); }
.pill-bad { background: var(--bad-bg); color: var(--bad); }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.person {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.subcard {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  padding: 3px 8px 3px 10px;
  font-size: 12px;
  background: #fff;
}
.chip button {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  padding: 0 2px;
  font-size: 14px;
}
.day-group { margin-top: 8px; }
.slot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  margin-bottom: 8px;
}
.slot-time { font-weight: 600; }
.heat-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
  margin-bottom: 8px;
}
.heat-controls .field { flex: 0 1 auto; font-size: 12px; gap: 3px; }
.heat-controls input {
  padding: 4px 8px;
  font-size: 13px;
  width: 10.5rem;
  max-width: 100%;
}
.heat-controls select {
  padding: 4px 40px 4px 8px;
  font-size: 13px;
  width: 10.5rem;
  max-width: 100%;
}
select {
  appearance: none;
  -webkit-appearance: none;
  background-color: #fff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' fill='none' stroke='%231a1a1a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 40px;
}
.heat-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 4px;
  font-weight: 700;
  font-size: 12px;
}
.heat-scale {
  width: 120px;
  height: 12px;
  border: 1px solid #1a1a1a;
}
.heat-wrap { position: relative; width: 100%; overflow-x: auto; padding-bottom: 2px; }
.heat-table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.heat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 0;
  margin: 0 0 6px;
}
.heat-chips:empty { display: none; }
.heat-chips .chip { padding: 2px 6px 2px 8px; }
.heat-chips .sub { margin-left: 4px; }
.heat-day {
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  padding: 0 1px 2px;
  vertical-align: bottom;
  line-height: 1.15;
}
.heat-day small { display: block; font-size: 10px; font-weight: 600; }
.heat-time {
  width: 58px;
  text-align: right;
  padding: 0 6px 0 0;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  vertical-align: top;
  color: #1a1a1a;
}
.heat-table td { padding: 0; border-right: 1px solid #e6e6e6; border-bottom: 1px solid #e6e6e6; line-height: 0; }
.heat-table tr.hour td { border-bottom-color: #cfcfcf; }
.heat-table td:first-child { border-left: 1px solid #e6e6e6; }
.heat-table tbody tr:first-child td { border-top: 1px solid #e6e6e6; }
.heat-cell {
  display: block;
  width: 100%;
  min-width: 0;
  height: 22px;
  border: 0;
  padding: 0;
  background: #fff;
}
.heat-cell.is-unshared {
  background: repeating-linear-gradient(-45deg, #f4f4f4, #f4f4f4 3px, #e4e4e4 3px, #e4e4e4 6px) !important;
}
.heat-unshared-key {
  width: 28px;
  height: 12px;
  border: 1px solid #1a1a1a;
  background: repeating-linear-gradient(-45deg, #f4f4f4, #f4f4f4 3px, #e4e4e4 3px, #e4e4e4 6px);
}
.heat-cell.is-selected { box-shadow: inset 0 0 0 2px #1a1a1a; }
.heat-cell:hover, .heat-cell:focus { box-shadow: inset 0 0 0 1px #1a1a1a; }
.heat-cell.is-selected:hover, .heat-cell.is-selected:focus { box-shadow: inset 0 0 0 2px #1a1a1a; }
.heat-create, .heat-confirm {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fafafa;
}
.heat-confirm ul { margin: 6px 0 10px; padding-left: 18px; }
#heat-wrap { touch-action: none; user-select: none; }
.heat-hover {
  position: fixed;
  z-index: 40;
  background: #fff;
  color: #1a1a1a;
  border: 1px solid #1a1a1a;
  border-radius: 10px;
  padding: 10px 12px;
  min-width: 200px;
  max-width: 280px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
  pointer-events: none;
}
.heat-hover h3 { margin: 0 0 6px; font-size: 13px; }
.heat-hover p { margin: 8px 0 2px; font-size: 12px; font-weight: 700; }
.heat-hover .is-free { color: #0b7a32; }
.heat-hover .is-busy { color: #616161; }
.heat-hover ul { margin: 0; padding-left: 16px; font-size: 13px; }
.public-body { min-height: 100vh; }
.public-wrap {
  max-width: 520px;
  margin: 0 auto;
  padding: 48px 20px 64px;
}
.public-card { margin-top: 18px; }
.public-card .btn { margin-top: 8px; }
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
@media (max-width: 900px) {
  .app { flex-direction: column; }
  .sidebar { width: 100%; flex-basis: auto; height: auto; position: relative; }
  .nav { flex-direction: row; flex-wrap: wrap; }
  .sidebar-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .main-inner { padding: 18px 16px 48px; }
  .metrics, .grid-2, .grid-3, .form-grid { grid-template-columns: 1fr; }
  .person { grid-template-columns: 1fr; }
  .hero h1 { font-size: 30px; }
}
`;

function icon(body: string): string {
  return `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const ICONS = {
  home: icon(
    `<path d="M3.5 9.2 10 3.6l6.5 5.6V16.4a1 1 0 0 1-1 1H12v-4.2H8v4.2H4.5a1 1 0 0 1-1-1V9.2z"/>`,
  ),
  calendars: icon(
    `<rect x="3.4" y="4.4" width="13.2" height="12" rx="1.6"/><path d="M3.4 8.2h13.2M7 3.2v2.4M13 3.2v2.4"/>`,
  ),
  admin: icon(`<path d="M10 2.7 16.3 5.2v4.7c0 3.4-2.5 5.6-6.3 7.1-3.8-1.5-6.3-3.7-6.3-7.1V5.2L10 2.7z"/>`),
  out: icon(
    `<path d="M8 6.2V4.4H4.4v11.2H8v-1.8"/><path d="M8 10h8"/><path d="M13.2 7.1 16.2 10l-3 2.9"/>`,
  ),
};

function htmlResponse(html: string): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  });
  return new Response(html, { headers });
}

function doc(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231a1a1a'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-size='18' font-family='sans-serif' fill='white'%3EO%3C/text%3E%3C/svg%3E" />
  <style>${CSS}</style>
</head>
${body}
</html>`;
}

function brand(appName: string): string {
  return `<a class="brand" href="/">
    <span class="mark" aria-hidden="true">O</span>
    <span class="brand-text">
      <span class="brand-name">Operators</span>
      <span class="brand-sub">The Owners</span>
    </span>
  </a>
  <span class="sr-app">${escapeHtml(appName)}</span>`;
}

function navLink(
  href: string,
  id: string,
  label: string,
  glyph: string,
  current: boolean,
): string {
  return `<a class="nav-link" id="${id}" href="${href}"${
    current ? ' aria-current="page"' : ""
  }>${glyph}<span>${escapeHtml(label)}</span></a>`;
}

function calendarStatus(viewer: Viewer): string {
  if (viewer.isGuest) {
    return `<span class="status"><span class="dot"></span>Not required</span>`;
  }
  if (viewer.calendarOk) {
    return `<span class="status"><span class="dot dot-ok"></span>Connected</span>`;
  }
  return `<span class="status"><span class="dot dot-warn"></span>Not connected</span>`;
}

function zoneLabel(timeZone: string): { value: string; sub: string } {
  if (timeZone === "America/Chicago") {
    return { value: "Central", sub: "America/Chicago" };
  }
  return { value: timeZone, sub: "Schedule timezone" };
}

function metrics(viewer: Viewer): string {
  const zone = zoneLabel(viewer.timeZone);
  return `<section class="metrics" aria-label="Account status">
    <div class="metric">
      <div class="metric-label">Signed in</div>
      <div class="metric-value" id="metric-email">${escapeHtml(viewer.email)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Role</div>
      <div class="metric-value" id="metric-role">${escapeHtml(roleLabel(viewer.role))}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Calendar</div>
      <div class="metric-value" id="metric-calendar">${calendarStatus(viewer)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Time zone</div>
      <div class="metric-value" id="metric-tz">${escapeHtml(zone.value)}</div>
      <div class="sub">${escapeHtml(zone.sub)}</div>
    </div>
  </section>`;
}

function sidebar(viewer: Viewer, active: NavKey): string {
  const admin =
    viewer.role === "admin"
      ? navLink("/admin", "nav-admin", "Admin", ICONS.admin, active === "admin")
      : "";
  return `<aside class="sidebar">
    ${brand(viewer.appName)}
    <nav aria-label="Primary">
      ${navLink("/", "nav-home", "Home", ICONS.home, active === "home")}
      ${navLink("/calendars", "nav-calendars", "Calendars", ICONS.calendars, active === "calendars")}
      ${admin}
    </nav>
    <div class="sidebar-foot">
      <div class="who">
        <div class="who-email">${escapeHtml(viewer.email)}</div>
        <div class="who-role">${escapeHtml(roleLabel(viewer.role))}</div>
      </div>
      ${navLink("/auth/logout", "nav-signout", "Sign out", ICONS.out, false)}
    </div>
  </aside>`;
}

export function renderApp(opts: {
  title: string;
  page: string;
  active: NavKey;
  viewer: Viewer;
  main: string;
}): Response {
  const fullTitle =
    opts.title === opts.viewer.appName
      ? opts.title
      : `${opts.title} · ${opts.viewer.appName}`;
  const body = `<body
    data-page="${escapeHtml(opts.page)}"
    data-role="${escapeHtml(opts.viewer.role)}"
    data-guest="${opts.viewer.isGuest ? "true" : "false"}"
    data-calendar="${opts.viewer.calendarOk ? "ok" : "missing"}"
    data-email="${escapeHtml(opts.viewer.email)}"
    data-tz="${escapeHtml(opts.viewer.timeZone)}"
  >
    <a class="skip" href="#main">Skip to content</a>
    <div class="app">
      ${sidebar(opts.viewer, opts.active)}
      <main class="main" id="main">
        <div class="main-inner">
          ${metrics(opts.viewer)}
          ${opts.main}
        </div>
      </main>
    </div>
    <script>${clientScript().replaceAll("</script", "<\\/script")}</script>
  </body>`;
  return htmlResponse(doc(fullTitle, body));
}

export function renderPublic(title: string, main: string, appName: string): Response {
  const fullTitle = title === appName ? title : `${title} · ${appName}`;
  const body = `<body class="public-body" data-page="public">
    <div class="public-wrap">
      ${brand(appName)}
      <div class="card public-card">
        ${main}
      </div>
    </div>
  </body>`;
  return htmlResponse(doc(fullTitle, body));
}

export function renderGate(appName: string, main: string): Response {
  const body = `<body data-page="signin">
    <a class="skip" href="#main">Skip to content</a>
    <div class="app">
      <aside class="sidebar">
        ${brand(appName)}
        <nav aria-label="Primary">
          ${navLink("/", "nav-home", "Home", ICONS.home, true)}
          ${navLink("/auth/google/start", "nav-signin", "Sign in", ICONS.out, false)}
        </nav>
      </aside>
      <main class="main" id="main">
        <div class="main-inner">
          ${main}
        </div>
      </main>
    </div>
  </body>`;
  return htmlResponse(doc(appName, body));
}
