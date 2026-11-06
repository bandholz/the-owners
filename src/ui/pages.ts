import type { UserRow } from "../types";
import {
  escapeHtml,
  renderApp,
  renderGate,
  renderPublic,
  type NavKey,
  type Viewer,
} from "./shell";
import { greetingFor, greetingName } from "./time";

export { escapeHtml };

export interface ViewerSource {
  APP_NAME: string;
  DEFAULT_TIMEZONE: string;
}

export function toViewer(env: ViewerSource, user: UserRow): Viewer {
  return {
    appName: env.APP_NAME,
    email: user.email,
    name: user.name,
    role: user.role,
    calendarOk: user.token_status === "ok",
    isGuest: user.role === "guest",
    timeZone: env.DEFAULT_TIMEZONE,
  };
}

export function htmlPage(title: string, body: string, appName = "Operators: The Owners Scheduler"): Response {
  return renderPublic(title, body, appName);
}

export function homePage(opts: {
  appName: string;
  signedIn: boolean;
  email?: string;
  name?: string | null;
  role?: string;
  calendarOk?: boolean;
  isGuest?: boolean;
  timeZone?: string;
}): Response {
  if (!opts.signedIn) {
    return renderGate(
      opts.appName,
      `<header class="hero">
        <h1>${escapeHtml(opts.appName)}</h1>
        <p class="lede">Invite-only. Sign in with the Google account an admin invited.</p>
      </header>
      <section class="card" data-filter="sign in">
        <h2>Sign in</h2>
        <p>Available times are shown in Central Time (America/Chicago).</p>
        <a class="btn btn-primary" href="/auth/google/start">Sign in with Google</a>
      </section>`,
    );
  }

  const viewer: Viewer = {
    appName: opts.appName,
    email: opts.email ?? "",
    name: opts.name,
    role: opts.role ?? "",
    calendarOk: Boolean(opts.calendarOk),
    isGuest: Boolean(opts.isGuest),
    timeZone: opts.timeZone ?? "America/Chicago",
  };
  const name = greetingName(viewer.name);
  const hello = greetingFor(new Date(), viewer.timeZone);
  const heading = name ? `${hello}, ${name}` : hello;

  const connectFirst = !viewer.isGuest && !viewer.calendarOk;
  const chips = [
    connectFirst
      ? `<a class="btn btn-primary" href="/auth/google/calendar/start">Connect Google Calendar</a>`
      : `<a class="btn btn-primary" href="/app">Available times</a>`,
    connectFirst ? `<a class="btn" href="/app">Available times</a>` : "",
    `<a class="btn" href="/calendars">Calendars</a>`,
    viewer.role === "admin" ? `<a class="btn" href="/admin">Admin</a>` : "",
  ]
    .filter(Boolean)
    .join("");

  const calendarCard = viewer.isGuest
    ? `<section class="card" data-filter="calendar guest">
        <h2>Calendar</h2>
        <p>Guests can use Available times without connecting a calendar. You only see free time for the people you select.</p>
        <a class="btn" href="/app">Available times</a>
      </section>`
    : viewer.calendarOk
      ? `<section class="card" data-filter="calendar connected">
          <h2>Calendar connected</h2>
          <p>Primary is included until you choose a different set. Only calendar names and ids are stored.</p>
          <a class="btn" href="/calendars">Review calendars</a>
        </section>`
      : `<section class="card" data-filter="calendar connect">
          <h2>Connect a calendar</h2>
          <p>Hosts, producers, and admins connect Google Calendar before their busy time can be included.</p>
          <a class="btn btn-primary" href="/auth/google/calendar/start">Connect Google Calendar</a>
        </section>`;

  const main = `<header class="hero">
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">See who is free and line up the next recording.</p>
    </header>
    <div class="chip-row">${chips}</div>
    <div class="grid-2">
      <section class="card" data-filter="available times people group">
        <h2>Available times</h2>
        <p>Pick people or a saved group. Open slots are listed in Central Time.</p>
        <a class="btn" href="/app">Open available times</a>
      </section>
      ${calendarCard}
    </div>
    <section class="card card-quiet" data-filter="disconnect delete my data">
      <h2>Disconnect and delete</h2>
      <p class="hint">Revokes calendar access and deletes your account, sessions, and saved calendar names.</p>
      <div id="delete-msg" class="banner" hidden></div>
      <button type="button" class="btn btn-danger" id="delete-account">Disconnect &amp; delete my data</button>
    </section>`;

  return renderApp({
    title: "Home",
    page: "home",
    active: "home",
    viewer,
    main,
  });
}

export function calendarsPage(viewer: Viewer): Response {
  const main = viewer.isGuest
    ? `<header class="page-head">
        <h1>Calendars</h1>
        <p class="lede">Guests do not connect a calendar.</p>
      </header>
      <div id="calendars-app" data-state="guest">
        <section class="card">
          <h2>No calendar needed</h2>
          <p>Use Available times to see when hosts and producers are free. You only see free time for the people you select.</p>
          <a class="btn btn-primary" href="/app">Available times</a>
        </section>
      </div>`
    : viewer.calendarOk
      ? `<header class="page-head">
          <h1>Calendars</h1>
          <p class="lede">Choose which calendars count toward busy time. It only shows as Busy or Free. Event details are never stored or shared with others.</p>
        </header>
        <div id="calendars-app" data-state="ready">
          <noscript><p class="banner banner-warn">JavaScript is required to load and save calendars.</p></noscript>
          <section class="card">
            <h2>Calendars that count</h2>
            <p class="hint">Names and ids only. Primary is selected by default until you save a different set.</p>
            <div id="calendars-msg" class="banner" hidden></div>
            <div id="calendars-body"><p class="hint">Loading calendars…</p></div>
          </section>
        </div>`
      : `<header class="page-head">
          <h1>Calendars</h1>
          <p class="lede">Connect Google Calendar before choosing which calendars count.</p>
        </header>
        <div id="calendars-app" data-state="connect">
          <section class="card">
            <h2>Connect Google Calendar</h2>
            <p>The connection reads free/busy and the calendar list. Event titles, guests, and descriptions are not requested or stored.</p>
            <a class="btn btn-primary" href="/auth/google/calendar/start">Connect Google Calendar</a>
          </section>
        </div>`;

  return renderApp({
    title: "Calendars",
    page: "calendars",
    active: "calendars",
    viewer,
    main,
  });
}

export function availableTimesPage(viewer: Viewer): Response {
  const main = `<header class="page-head">
      <h1>Available times</h1>
      <p class="lede">Overlapping free time in Central Time (${escapeHtml(viewer.timeZone)}).</p>
    </header>
    <div id="times-app" class="stack">
      <noscript><p class="banner banner-warn">JavaScript is required to load people and available times.</p></noscript>
      <section class="card">
        <h2>Who needs to be free</h2>
        <p class="hint">Pick people, a saved group, or both. A group includes every member. Your calendar is included only when you select yourself.</p>
        <div id="guest-note" class="banner" hidden></div>
        <label class="field">Saved group
          <select id="group-id">
            <option value="">No saved group</option>
          </select>
        </label>
        <div id="people-list" class="stack-sm"><p class="hint">Loading people…</p></div>
      </section>
      <section class="card">
        <h2>When</h2>
        <form id="times-form" class="stack-sm">
          <div class="form-grid">
            <label class="field">Start date
              <input id="range-start" type="date" required />
            </label>
            <label class="field">End date
              <input id="range-end" type="date" required />
            </label>
            <label class="field">Meeting length
              <select id="duration">
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60" selected>60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">2 hours</option>
              </select>
            </label>
            <label class="field">Daily window
              <span class="window">
                <input id="window-start" type="time" value="09:00" required />
                <span class="to">to</span>
                <input id="window-end" type="time" value="17:00" required />
              </span>
            </label>
          </div>
          <p class="hint">Up to 14 days. Results step every 15 minutes inside the daily window.</p>
          <div class="row">
            <button class="btn btn-primary" type="submit">Show available times</button>
          </div>
        </form>
      </section>
      <section class="card">
        <h2>Open slots</h2>
        <div id="times-msg" class="banner" hidden></div>
        <div id="times-results"><p class="hint">Choose people and a range, then show available times.</p></div>
      </section>
    </div>`;

  return renderApp({
    title: "Available times",
    page: "times",
    active: "times",
    viewer,
    main,
  });
}

export function adminPage(viewer: Viewer): Response {
  const main = `<header class="page-head">
      <h1>Admin</h1>
      <p class="lede">Invite list, roles, groups, Access sync, and the Google test-user checklist.</p>
    </header>
    <div id="admin-app" class="stack">
      <noscript><p class="banner banner-warn">JavaScript is required to manage the invite list.</p></noscript>
      <section class="card" id="roster-card">
        <h2>People</h2>
        <p class="hint">Invite the Google account that should be able to sign in. Removing someone deletes their stored data. The invite list is the source of truth for Access.</p>
        <form id="invite-form" class="form-row">
          <label class="field">Email
            <input id="invite-email" name="email" type="email" required autocomplete="off" />
          </label>
          <label class="field">Role
            <select id="invite-role" name="role">
              <option value="host">Host</option>
              <option value="producer">Producer</option>
              <option value="guest">Guest</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button class="btn btn-primary" type="submit">Invite</button>
        </form>
        <div id="invite-msg" class="banner" hidden></div>
        <div id="roster-list"><p class="hint">Loading people…</p></div>
      </section>
      <section class="card" id="groups-card">
        <h2>Groups</h2>
        <p class="hint">Saved groups can be picked on Available times. Choosing a group includes every member.</p>
        <form id="group-create-form" class="form-row">
          <label class="field">Name
            <input id="group-name" type="text" required maxlength="80" />
          </label>
          <button class="btn btn-primary" type="submit">Create group</button>
        </form>
        <div id="group-msg" class="banner" hidden></div>
        <div id="group-list"></div>
      </section>
      <section class="card" id="access-card">
        <h2>Access sync</h2>
        <p class="hint">Status of the Cloudflare Access policy. Sync runs only when it is configured, and it follows the invite list.</p>
        <div id="access-msg" class="banner" hidden></div>
        <div id="access-status"><p class="hint">Loading Access status…</p></div>
        <button type="button" class="btn" id="access-sync-btn">Sync Access now</button>
      </section>
      <section class="card" id="google-card">
        <h2>Google test users</h2>
        <p class="hint">Google has no API for OAuth test users. Add or remove these emails in Google Cloud Console → OAuth consent screen → Test users, then mark them here. Marking a row updates this checklist only.</p>
        <div id="google-msg" class="banner" hidden></div>
        <div id="google-lists"><p class="hint">Loading checklist…</p></div>
      </section>
    </div>`;

  return renderApp({
    title: "Admin",
    page: "admin",
    active: "admin",
    viewer,
    main,
  });
}

export function noticePage(
  viewer: Viewer,
  opts: { title: string; active: NavKey; heading: string; body: string },
): Response {
  const main = `<header class="page-head">
      <h1>${escapeHtml(opts.heading)}</h1>
    </header>
    <section class="card">${opts.body}</section>`;
  return renderApp({
    title: opts.title,
    page: "notice",
    active: opts.active,
    viewer,
    main,
  });
}

export function deletePage(viewer: Viewer): Response {
  const main = `<header class="page-head">
      <h1>Disconnect and delete</h1>
      <p class="lede">This revokes calendar access and deletes your account, sessions, and saved calendar names.</p>
    </header>
    <section class="card">
      <div id="delete-msg" class="banner" hidden></div>
      <button type="button" class="btn btn-danger" id="delete-account">Disconnect &amp; delete my data</button>
    </section>`;
  return renderApp({
    title: "Delete my data",
    page: "delete",
    active: "home",
    viewer,
    main,
  });
}
