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

function minuteOptions(selected: number): string {
  let html = "";
  for (let minutes = 6 * 60; minutes <= 22 * 60; minutes += 30) {
    const h24 = Math.floor(minutes / 60);
    const min = minutes % 60;
    const suffix = h24 >= 12 ? "PM" : "AM";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    const label = `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
    html += `<option value="${minutes}"${minutes === selected ? " selected" : ""}>${label}</option>`;
  }
  return html;
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
      <section class="card">
        <h2>Sign in</h2>
        <p>Times are shown in Central Time (America/Chicago).</p>
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

  const statusNote = viewer.isGuest
    ? `<p class="banner" id="heat-guest">Guests can check availability without connecting a calendar. Select people who have connected.</p>`
    : viewer.calendarOk
      ? ""
      : `<p class="banner banner-warn">Connect Google Calendar before your own time can be included. <a href="/auth/google/calendar/start">Connect Google Calendar</a></p>`;

  const main = `<header class="page-head">
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">See who is free. Darker green means more of the selected people are available. Times are Central (${escapeHtml(viewer.timeZone)}).</p>
    </header>
    <section class="card" id="heat-app">
      ${statusNote}
      <form id="heat-form" class="heat-controls">
        <div class="heat-row">
          <div class="range-picker" id="heat-range">
            <button type="button" class="range-trigger" id="heat-range-trigger" aria-expanded="false" aria-haspopup="dialog" aria-controls="heat-range-popover">
              <svg class="icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="4.4" width="13.2" height="12" rx="1.6"/><path d="M3.4 8.2h13.2M7 3.2v2.4M13 3.2v2.4"/></svg>
              <span id="heat-range-label">Next week</span>
              <svg class="range-chevron" viewBox="0 0 12 8" aria-hidden="true" width="12" height="8"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="range-popover" id="heat-range-popover" hidden role="dialog" aria-label="Date range">
              <div class="range-presets" role="listbox" aria-label="Range presets">
                <button type="button" class="range-preset is-active" data-preset="next" aria-selected="true">Next week</button>
                <button type="button" class="range-preset" data-preset="custom" aria-selected="false">Custom range</button>
              </div>
              <div class="range-body">
                <div class="range-fields">
                  <label class="field">Start
                    <input id="heat-range-start" type="text" inputmode="text" autocomplete="off" spellcheck="false" />
                  </label>
                  <label class="field">End
                    <input id="heat-range-end" type="text" inputmode="text" autocomplete="off" spellcheck="false" />
                  </label>
                </div>
                <p id="heat-range-note" class="hint" hidden></p>
                <div class="range-months" id="heat-months"></div>
                <div class="range-actions">
                  <button type="button" class="btn" id="heat-range-cancel">Cancel</button>
                  <button type="button" class="btn btn-primary" id="heat-range-apply">Apply</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="heat-row">
          <label class="field">Group
            <select id="heat-group">
              <option value="">Add a group</option>
            </select>
          </label>
          <label class="field">People
            <select id="heat-person">
              <option value="">Add a person</option>
            </select>
          </label>
        </div>
      </form>
      <div id="heat-people" class="heat-chips"></div>
      <div class="heat-legend">
        <span id="heat-legend-min">0/0 Available</span>
        <span id="heat-scale" class="heat-scale"></span>
        <span id="heat-legend-max">0/0 Available</span>
        <span class="heat-key"><span class="heat-unshared-key" aria-hidden="true"></span> Not shared</span>
      </div>
      <p class="hint" id="heat-rules">Hover or tap a time to see who is free, busy, or not shared. 9:00 AM–5:00 PM Central. Next week is one week. Custom ranges stop at the max days shown.</p>
      <div id="heat-msg" class="banner" hidden></div>
      <div id="heat-create" class="heat-create" hidden>
        <label class="field">Title
          <input id="heat-title" type="text" maxlength="140" placeholder="Recording" />
        </label>
        <p id="heat-create-summary" class="hint"></p>
        <div class="row">
          <button type="button" class="btn btn-primary" id="heat-review">Review event</button>
          <button type="button" class="btn" id="heat-clear">Clear</button>
        </div>
      </div>
      <div id="heat-confirm" class="heat-confirm" hidden>
        <p id="heat-confirm-copy"></p>
        <ul id="heat-confirm-list"></ul>
        <div class="row">
          <button type="button" class="btn btn-primary" id="heat-confirm-go">Create on my calendar</button>
          <button type="button" class="btn" id="heat-confirm-back">Back</button>
        </div>
      </div>
      <div id="heat-wrap" class="heat-wrap">
        <div id="heat-grid"><p class="hint">Select people or a saved group.</p></div>
      </div>
      <div id="heat-hover" class="heat-hover" hidden></div>
    </section>`;

  return renderApp({
    title: "Home",
    page: "home",
    active: "home",
    viewer,
    main,
  });
}

function shareWindowCard(): string {
  return `<section class="card" id="share-window-card">
      <h2>What others can see</h2>
      <p class="hint">Choose how far ahead other people can see your free or busy time. Outside that window, your time is not shared. Next week is the next 7 days, and next month is the next 30 days, both rolling forward from now in Central Time.</p>
      <form id="share-window-form" class="stack-sm">
        <label class="check-row"><input type="radio" name="share-window" value="full" checked /> <span>Full future</span></label>
        <label class="check-row"><input type="radio" name="share-window" value="week" /> <span>Next week</span></label>
        <label class="check-row"><input type="radio" name="share-window" value="month" /> <span>Next month</span></label>
        <div class="row"><button class="btn btn-primary" type="submit">Save sharing</button></div>
      </form>
      <div id="share-window-msg" class="banner" hidden></div>
    </section>`;
}

function disconnectCard(): string {
  return `<section class="card card-quiet" id="disconnect-card">
      <h2>Disconnect and delete</h2>
      <p class="hint">Revokes calendar access and deletes your account, sessions, and saved calendar names.</p>
      <div id="delete-msg" class="banner" hidden></div>
      <button type="button" class="btn btn-danger" id="delete-account">Disconnect &amp; delete my data</button>
    </section>`;
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
          <p>Use Home to see when hosts and producers are free. You only see free time for the people you select.</p>
          <a class="btn btn-primary" href="/">Home</a>
        </section>
      </div>
      ${disconnectCard()}`
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
        </div>
        ${shareWindowCard()}
        ${disconnectCard()}`
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
        </div>
        ${shareWindowCard()}
        ${disconnectCard()}`;

  return renderApp({
    title: "Calendars",
    page: "calendars",
    active: "calendars",
    viewer,
    main,
  });
}

export function adminPage(viewer: Viewer): Response {
  const main = `<header class="page-head">
      <h1>Admin</h1>
      <p class="lede">Invite list, roles, groups, heatmap rules, Access sync, and the Google test-user checklist.</p>
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
      <section class="card" id="heatmap-settings-card">
        <h2>Heatmap</h2>
        <p class="hint">These rules apply to everyone on Home. Times are Central (America/Chicago). Busy or free only. Max days shown is the most days a custom range can display.</p>
        <form id="heatmap-settings-form" class="form-grid">
          <label class="field">Max days shown
            <input id="heat-day-count" type="number" min="1" max="14" step="1" value="5" required />
          </label>
          <label class="field">Weekends
            <select id="heat-show-weekends">
              <option value="no">Weekdays only</option>
              <option value="yes">Include Saturday and Sunday</option>
            </select>
          </label>
          <label class="field">From
            <select id="heat-admin-start">${minuteOptions(9 * 60)}</select>
          </label>
          <label class="field">Until
            <select id="heat-admin-end">${minuteOptions(17 * 60)}</select>
          </label>
          <label class="field">Default selection
            <select id="heat-default-group">
              <option value="Hosts">Hosts</option>
              <option value="">No one</option>
            </select>
          </label>
          <p class="hint">Home opens with this saved group selected. Hosts is the default until you change it.</p>
          <button class="btn btn-primary" type="submit">Save heatmap</button>
        </form>
        <div id="heatmap-settings-msg" class="banner" hidden></div>
      </section>
      <section class="card" id="groups-card">
        <h2>Groups</h2>
        <p class="hint">Saved groups can be picked on Home. Choosing a group includes every member.</p>
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
