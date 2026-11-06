import { HEAT_STOPS } from "../freebusy/heatmap";
import { TIME_FNS } from "./time";

/**
 * Page script for the signed-in screens. Talks to existing JSON APIs.
 * Renders with textContent. Stores calendar ids and names only.
 */
export function clientScript(): string {
  return `(() => {
"use strict";
${TIME_FNS}
const HEAT_STOPS = ${JSON.stringify(HEAT_STOPS)};
const page = document.body.getAttribute("data-page") || "";
const tz = document.body.getAttribute("data-tz") || "America/Chicago";
const selfEmail = (document.body.getAttribute("data-email") || "").toLowerCase();
let meCache = null;

function readJson(res) {
  return res.text().then((text) => {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: text.slice(0, 180) };
    }
  });
}

function loadMe(force) {
  if (meCache && !force) return Promise.resolve(meCache);
  return fetch("/api/me").then((res) =>
    readJson(res).then((data) => {
      if (!res.ok) throw new Error(data.error || "Sign in required");
      meCache = data;
      return data;
    }),
  );
}

function getJson(path) {
  return fetch(path).then((res) =>
    readJson(res).then((data) => {
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    }),
  );
}

function send(method, path, body) {
  function once(force) {
    return loadMe(force).then((me) =>
      fetch(path, {
        method: method,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": me.csrf,
        },
        body: JSON.stringify(body || {}),
      }).then((res) => readJson(res).then((data) => ({ res: res, data: data }))),
    );
  }
  return once(false).then((out) => {
    if (out.res.status === 403 && out.data && out.data.error === "csrf") {
      return once(true);
    }
    return out;
  }).then((out) => {
    if (!out.res.ok) throw new Error((out.data && out.data.error) || "Request failed");
    return out.data;
  });
}

function setBanner(node, kind, text) {
  if (!node) return;
  if (!text) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.className = "banner" + (kind ? " banner-" + kind : "");
  node.textContent = text;
}

function clear(node) {
  if (node) node.replaceChildren();
}

function h(tag, props) {
  const node = document.createElement(tag);
  if (!props) return node;
  Object.keys(props).forEach((key) => {
    const val = props[key];
    if (val == null || val === false) return;
    if (key === "class") node.className = String(val);
    else if (key === "text") node.textContent = String(val);
    else node.setAttribute(key, String(val));
  });
  return node;
}

function heatFill(freeCount, total) {
  if (total <= 0 || freeCount <= 0) return HEAT_STOPS[0];
  const t = freeCount / total;
  const capped = t < 0 ? 0 : t > 1 ? 1 : t;
  let idx = Math.round(capped * (HEAT_STOPS.length - 1));
  if (idx < 1) idx = 1;
  if (idx > HEAT_STOPS.length - 1) idx = HEAT_STOPS.length - 1;
  return HEAT_STOPS[idx];
}

function pill(text, tone) {
  return h("span", { class: "pill" + (tone ? " pill-" + tone : ""), text: text });
}

function roleText(role) {
  if (role === "admin") return "Admin";
  if (role === "host") return "Host";
  if (role === "producer") return "Producer";
  if (role === "guest") return "Guest";
  return role || "";
}

function statusText(status) {
  if (status === "ok") return "Connected";
  if (status === "none") return "Not connected";
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  return status || "Unknown";
}

function statusTone(status) {
  if (status === "ok") return "ok";
  if (status === "none") return "warn";
  return "bad";
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function chicagoToday() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach((p) => {
    if (p.type !== "literal") parts[p.type] = p.value;
  });
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function addDays(iso, n) {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso);
  if (!m) return iso;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + n);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + mo + "-" + d;
}

function initHome() {
  const btn = document.getElementById("delete-account");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!confirm("Disconnect Google Calendar and delete your account data?")) return;
    btn.disabled = true;
    loadMe(false).then((me) =>
      fetch("/me/delete", {
        method: "POST",
        headers: { "x-csrf-token": me.csrf },
        redirect: "manual",
      }),
    ).then((res) => {
      if (res.status === 403) throw new Error("Could not confirm the request. Reload and try again.");
      if (res.status >= 400) {
        return readJson(res).then((data) => {
          throw new Error(data.error || "Could not delete the account");
        });
      }
      window.location.href = "/";
    }).catch((err) => {
      btn.disabled = false;
      setBanner(document.getElementById("delete-msg"), "bad", err.message || "Could not delete the account");
    });
  });
}

function weekdayIndex(iso) {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return dt.getUTCDay();
}

function rollToWeekday(iso) {
  let cursor = iso;
  let guard = 0;
  while (guard < 7) {
    const day = weekdayIndex(cursor);
    if (day !== 0 && day !== 6) return cursor;
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return iso;
}

function addBusinessDays(iso, count) {
  let cursor = iso;
  let left = count;
  while (left > 0) {
    cursor = addDays(cursor, 1);
    const day = weekdayIndex(cursor);
    if (day !== 0 && day !== 6) left -= 1;
  }
  return cursor;
}

function businessDayCount(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) return null;
  let count = 0;
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 40) {
    const day = weekdayIndex(cursor);
    if (day !== 0 && day !== 6) count += 1;
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return count;
}

function initHeat() {
  const root = document.getElementById("heat-app");
  if (!root) return;
  const peopleEl = document.getElementById("heat-people");
  const groupEl = document.getElementById("heat-group");
  const start = document.getElementById("heat-start");
  const end = document.getElementById("heat-end");
  const msg = document.getElementById("heat-msg");
  const gridEl = document.getElementById("heat-grid");
  const hover = document.getElementById("heat-hover");
  const scale = document.getElementById("heat-scale");
  const legendMin = document.getElementById("heat-legend-min");
  const legendMax = document.getElementById("heat-legend-max");
  if (scale) scale.style.background = "linear-gradient(90deg," + HEAT_STOPS.join(",") + ")";

  const personEl = document.getElementById("heat-person");
  const rulesEl = document.getElementById("heat-rules");
  let heatSettings = {
    dayCount: 5,
    showWeekends: false,
    windowStartMinutes: 9 * 60,
    windowEndMinutes: 17 * 60,
  };
  let people = [];
  let groups = [];
  let pickedIds = {};
  let heatTimer = null;
  let heatAbort = null;

  function includedDayCount(startDate, endDate) {
    if (!startDate || !endDate || startDate > endDate) return null;
    let count = 0;
    let cursor = startDate;
    let guard = 0;
    while (cursor <= endDate && guard < 60) {
      const day = weekdayIndex(cursor);
      if (heatSettings.showWeekends || (day !== 0 && day !== 6)) count += 1;
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return count;
  }

  function formatMinutes(minutes) {
    const h24 = Math.floor(minutes / 60) % 24;
    const min = minutes % 60;
    const suffix = h24 >= 12 ? "PM" : "AM";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    const mm = min < 10 ? "0" + min : String(min);
    return h12 + ":" + mm + " " + suffix;
  }

  function applyHeatSettings(data) {
    if (data && Number.isInteger(data.dayCount)) heatSettings.dayCount = data.dayCount;
    if (data) heatSettings.showWeekends = !!data.showWeekends;
    if (data && Number.isInteger(data.windowStartMinutes)) {
      heatSettings.windowStartMinutes = data.windowStartMinutes;
    }
    if (data && Number.isInteger(data.windowEndMinutes)) {
      heatSettings.windowEndMinutes = data.windowEndMinutes;
    }
    const span = heatSettings.showWeekends ? "days" : "weekdays";
    const weekend = heatSettings.showWeekends ? "including weekends" : "weekdays only";
    if (rulesEl) {
      rulesEl.textContent =
        "Hover a time to see who is free and who is busy. " +
        formatMinutes(heatSettings.windowStartMinutes) +
        "–" +
        formatMinutes(heatSettings.windowEndMinutes) +
        " Central, " +
        weekend +
        ", at most " +
        heatSettings.dayCount +
        " " +
        span +
        ".";
    }
    if (start && !start.value) {
      const from = heatSettings.showWeekends ? chicagoToday() : rollToWeekday(chicagoToday());
      start.value = from;
      end.value = heatSettings.showWeekends
        ? addDays(from, Math.max(0, heatSettings.dayCount - 1))
        : addBusinessDays(from, Math.max(0, heatSettings.dayCount - 1));
    }
  }

  function memberSet() {
    const group = groups.find((g) => g.id === groupEl.value);
    const set = {};
    const ids = group && Array.isArray(group.memberIds) ? group.memberIds : [];
    ids.forEach((id) => {
      set[id] = true;
    });
    return set;
  }

  function renderPeople() {
    const members = memberSet();
    clear(peopleEl);
    people.forEach((person) => {
      const inGroup = !!members[person.id];
      if (!inGroup && !pickedIds[person.id]) return;
      const display = person.name || person.email || "Person";
      const chip = h("span", { class: "chip" });
      chip.append(h("span", { text: display }));
      if (inGroup) {
        chip.append(h("span", { class: "sub", text: "Group" }));
      } else {
        const remove = h("button", {
          type: "button",
          text: "×",
          "aria-label": "Remove " + display,
        });
        remove.addEventListener("click", () => {
          delete pickedIds[person.id];
          renderPeople();
          scheduleHeat();
        });
        chip.append(remove);
      }
      peopleEl.append(chip);
    });
    if (!personEl) return;
    while (personEl.options.length > 1) personEl.remove(1);
    personEl.options[0].textContent = people.length ? "Add a person" : "No one invited";
    personEl.disabled = people.length === 0;
    people.forEach((person) => {
      if (members[person.id] || pickedIds[person.id]) return;
      const display = person.name || person.email || "Person";
      const suffix = person.token_status === "ok" ? "" : " (not connected)";
      const opt = h("option", { value: person.id, text: display + suffix });
      if (person.token_status !== "ok") opt.disabled = true;
      personEl.append(opt);
    });
    personEl.value = "";
  }

  function selectedIds() {
    const members = memberSet();
    const userIds = [];
    Object.keys(pickedIds).forEach((id) => {
      if (!members[id]) userIds.push(id);
    });
    const groupId = groupEl.value || "";
    const picked = people.filter((person) => members[person.id] || pickedIds[person.id]);
    return { groupId: groupId, userIds: userIds, picked: picked };
  }

  function setLegend(total) {
    if (legendMin) legendMin.textContent = "0/" + total + " Available";
    if (legendMax) legendMax.textContent = total + "/" + total + " Available";
  }

  function hideHover() {
    if (!hover) return;
    hover.hidden = true;
    clear(hover);
  }

  function clockLabel(minutes) {
    const h24 = Math.floor(minutes / 60) % 24;
    const min = minutes % 60;
    const suffix = h24 >= 12 ? "PM" : "AM";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    const mm = min < 10 ? "0" + min : String(min);
    return h12 + ":" + mm + " " + suffix;
  }

  function showHover(cell, anchor) {
    clear(hover);
    hover.hidden = false;
    const when = [cell.weekday, cell.dayLabel, cell.label + "–" + cell.endLabel]
      .filter(Boolean)
      .join(" ");
    hover.append(h("h3", { text: when }));
    const free = [];
    const busy = [];
    (cell.people || []).forEach((person) => {
      const label = person.name || person.email || "Person";
      if (person.status === "free") free.push(label);
      else busy.push(label);
    });
    function names(title, list, cls) {
      hover.append(h("p", { class: cls, text: title }));
      const ul = h("ul", {});
      if (!list.length) ul.append(h("li", { text: "None" }));
      list.forEach((name) => ul.append(h("li", { text: name })));
      hover.append(ul);
    }
    names("Free", free, "is-free");
    names("Busy", busy, "is-busy");
    const host = document.getElementById("heat-wrap").getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = 230;
    let left = rect.right - host.left + 8;
    if (rect.right + width > host.right) left = rect.left - host.left - width - 8;
    hover.style.left = Math.max(0, left) + "px";
    hover.style.top = Math.max(0, rect.top - host.top) + "px";
  }

  function renderGrid(data) {
    clear(gridEl);
    hideHover();
    const total = typeof data.total === "number" ? data.total : (data.people || []).length;
    setLegend(total);
    const days = (Array.isArray(data.days) ? data.days : []).filter((day) => {
      if (heatSettings.showWeekends) return true;
      const name = day.weekday || "";
      return name !== "Sat" && name !== "Sun";
    });
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const cells = Array.isArray(data.cells) ? data.cells : [];
    if (!days.length || !rows.length) {
      gridEl.append(h("p", { class: "hint", text: "No times in that window." }));
      return;
    }
    const byKey = {};
    cells.forEach((cell) => {
      byKey[cell.day + ":" + cell.minutes] = cell;
    });
    const table = h("table", { class: "heat-table" });
    const headRow = h("tr", {});
    headRow.append(h("th", { class: "heat-time" }));
    days.forEach((day) => {
      const th = h("th", { class: "heat-day" });
      th.append(h("small", { text: day.label || day.date || "" }));
      th.append(document.createTextNode(day.weekday || ""));
      headRow.append(th);
    });
    const thead = h("thead", {});
    thead.append(headRow);
    const tbody = h("tbody", {});
    rows.forEach((row, rowIndex) => {
      const tr = h("tr", {});
      tr.append(h("th", {
        class: "heat-time",
        text: row.minutes % 60 === 0 ? row.label : "",
      }));
      days.forEach((day, dayIndex) => {
        const cell = byKey[day.date + ":" + row.minutes] || { people: [], freeCount: 0, label: row.label };
        const button = h("button", { type: "button", class: "heat-cell" });
        if (dayIndex === 0) button.classList.add("edge-left");
        if (rowIndex === 0) button.classList.add("edge-top");
        const next = rows[rowIndex + 1];
        if (!next || next.minutes % 60 === 0) button.classList.add("hour");
        button.style.background = heatFill(cell.freeCount || 0, total);
        const enriched = {
          label: cell.label || row.label,
          endLabel: clockLabel(row.minutes + (data.slotMinutes || 30)),
          dayLabel: day.label || "",
          weekday: day.weekday || "",
          people: cell.people || [],
        };
        const freeNames = [];
        const busyNames = [];
        enriched.people.forEach((person) => {
          const name = person.name || person.email || "Person";
          if (person.status === "free") freeNames.push(name);
          else busyNames.push(name);
        });
        button.setAttribute(
          "aria-label",
          enriched.weekday + " " + enriched.dayLabel + " " + enriched.label +
            ". Free: " + (freeNames.join(", ") || "no one") +
            ". Busy: " + (busyNames.join(", ") || "no one"),
        );
        button.addEventListener("mouseenter", () => showHover(enriched, button));
        button.addEventListener("focus", () => showHover(enriched, button));
        button.addEventListener("mouseleave", hideHover);
        button.addEventListener("blur", hideHover);
        const td = h("td", {});
        td.append(button);
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(thead, tbody);
    gridEl.append(table);
  }

  function loadHeat() {
    const sel = selectedIds();
    setLegend(sel.picked.length);
    if (!sel.groupId && sel.userIds.length === 0) {
      clear(gridEl);
      hideHover();
      gridEl.append(h("p", { class: "hint", text: "Select people or a saved group." }));
      setBanner(msg, "", "");
      return;
    }
    const missing = sel.picked.filter((p) => p.token_status !== "ok");
    if (missing.length) {
      clear(gridEl);
      hideHover();
      setBanner(msg, "bad", "Calendar not connected for " + missing.map((p) => p.email).join(", ") + ".");
      return;
    }
    const included = includedDayCount(start.value, end.value);
    if (included == null) {
      setBanner(msg, "bad", "Choose a start date on or before the end date.");
      return;
    }
    if (included === 0) {
      setBanner(msg, "bad", heatSettings.showWeekends ? "Choose a date range." : "That range has no weekdays.");
      return;
    }
    if (included > heatSettings.dayCount) {
      const unit = heatSettings.showWeekends ? "days" : "business days";
      setBanner(msg, "bad", "Choose " + heatSettings.dayCount + " " + unit + " or fewer.");
      return;
    }
    let rangeStart = "";
    let rangeEnd = "";
    try {
      rangeStart = zonedWallTimeToIso(start.value, 0, 0, tz);
      rangeEnd = zonedWallTimeToIso(addDays(end.value, 1), 0, 0, tz);
    } catch (err) {
      setBanner(msg, "bad", "Those dates could not be read.");
      return;
    }
    if (heatAbort) heatAbort.abort();
    heatAbort = new AbortController();
    const signal = heatAbort.signal;
    setBanner(msg, "", "");
    const payload = {
      userIds: sel.userIds,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
    };
    if (sel.groupId) payload.groupId = sel.groupId;
    loadMe(false).then((me) => fetch("/api/availability", {
      method: "POST",
      signal: signal,
      headers: {
        "content-type": "application/json",
        "x-csrf-token": me.csrf,
      },
      body: JSON.stringify(payload),
    }).then((res) => readJson(res).then((data) => {
      if (signal.aborted) return;
      if (!res.ok) throw new Error(data.error || "Could not load availability");
      renderGrid(data);
    }))).catch((err) => {
      if (err && err.name === "AbortError") return;
      if (signal.aborted) return;
      setBanner(msg, "bad", (err && err.message) || "Could not load availability");
    });
  }

  function scheduleHeat() {
    clearTimeout(heatTimer);
    heatTimer = setTimeout(loadHeat, 200);
  }

  [start, end, groupEl].forEach((el) => {
    el.addEventListener("change", () => {
      if (el === groupEl) renderPeople();
      scheduleHeat();
    });
  });
  if (personEl) {
    personEl.addEventListener("change", () => {
      const id = personEl.value;
      if (!id) return;
      pickedIds[id] = true;
      renderPeople();
      scheduleHeat();
    });
  }

  Promise.all([
    getJson("/api/heatmap-settings"),
    getJson("/api/people"),
    getJson("/api/groups"),
  ])
    .then((triple) => {
      applyHeatSettings(triple[0]);
      people = Array.isArray(triple[1].people) ? triple[1].people : [];
      groups = Array.isArray(triple[2].groups) ? triple[2].groups : [];
      groups.forEach((group) => {
        groupEl.append(h("option", { value: group.id, text: group.name || "Group" }));
      });
      people.forEach((person) => {
        if (person.role === "host") pickedIds[person.id] = true;
      });
      renderPeople();
      scheduleHeat();
    })
    .catch((err) => {
      setBanner(msg, "bad", err.message || "Could not load people");
    });
}

function initCalendars() {
  const root = document.getElementById("calendars-app");
  if (!root || root.getAttribute("data-state") !== "ready") return;
  const body = document.getElementById("calendars-body");
  const msg = document.getElementById("calendars-msg");
  loadMe(false)
    .then(() => getJson("/api/calendars"))
    .then((data) => renderCalendars(body, msg, data))
    .catch((err) => {
      setBanner(msg, "bad", err.message || "Could not load calendars");
      clear(body);
    });
}

function renderCalendars(body, msg, data) {
  clear(body);
  const available = Array.isArray(data.available) ? data.available : [];
  const selected = Array.isArray(data.selected) ? data.selected : [];
  const selectedIds = {};
  selected.forEach((c) => {
    if (c && c.id) selectedIds[c.id] = true;
  });
  const noneSelected = selected.length === 0;
  const rows = available.length
    ? available
    : selected.length
      ? selected
      : [{ id: "primary", summary: "Primary", primary: true }];
  const form = h("form", { id: "calendars-form" });
  const list = h("div", { class: "stack-sm" });
  rows.forEach((cal) => {
    const id = String(cal.id || "");
    const summary = String(cal.summary || id);
    const isPrimary = !!cal.primary;
    const box = h("input", { type: "checkbox" });
    box.checked = !!selectedIds[id] || (noneSelected && isPrimary);
    box.setAttribute("data-id", id);
    box.setAttribute("data-summary", summary);
    box.setAttribute("data-primary", isPrimary ? "1" : "0");
    const label = h("label", { class: "check-row" });
    const copy = h("span", { class: "check-copy" });
    copy.append(h("span", { class: "check-title", text: summary }));
    copy.append(h("span", { class: "sub", text: id }));
    label.append(box, copy);
    if (isPrimary) label.append(pill("Primary", "ok"));
    list.append(label);
  });
  const save = h("button", { class: "btn btn-primary", type: "submit", text: "Save calendars" });
  const note = h("p", {
    class: "hint",
    text: noneSelected
      ? "Primary is selected by default until you save a different set."
      : "Showing your saved selection.",
  });
  const actions = h("div", { class: "row" });
  actions.append(save);
  form.append(list, note, actions);
  body.append(form);
  function chosen() {
    const calendars = [];
    list.querySelectorAll("input[type=checkbox]").forEach((box) => {
      if (!box.checked) return;
      calendars.push({
        id: box.getAttribute("data-id"),
        summary: box.getAttribute("data-summary"),
        primary: box.getAttribute("data-primary") === "1",
      });
    });
    return calendars;
  }
  function syncSave() {
    save.disabled = chosen().length === 0;
  }
  list.addEventListener("change", syncSave);
  syncSave();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const calendars = chosen();
    if (!calendars.length) {
      setBanner(msg, "bad", "Select at least one calendar.");
      return;
    }
    save.disabled = true;
    send("PUT", "/api/calendars", { calendars: calendars })
      .then(() => {
        setBanner(msg, "ok", "Saved. Only calendar names and ids were stored.");
      })
      .catch((err) => {
        setBanner(msg, "bad", err.message || "Could not save");
      })
      .then(() => {
        save.disabled = chosen().length === 0;
      });
  });
}

function initTimes() {
  const root = document.getElementById("times-app");
  if (!root) return;
  const peopleEl = document.getElementById("people-list");
  const groupEl = document.getElementById("group-id");
  const form = document.getElementById("times-form");
  const msg = document.getElementById("times-msg");
  const results = document.getElementById("times-results");
  const guestNote = document.getElementById("guest-note");
  if (document.body.getAttribute("data-guest") === "true" && guestNote) {
    guestNote.hidden = false;
    guestNote.textContent = "Guests can look up available times without connecting a calendar. Select people who have connected.";
  }
  const start = document.getElementById("range-start");
  const end = document.getElementById("range-end");
  const today = chicagoToday();
  if (start && !start.value) start.value = today;
  if (end && !end.value) end.value = addDays(today, 6);

  let people = [];
  let groups = [];

  function memberSet() {
    const group = groups.find((g) => g.id === groupEl.value);
    const set = {};
    const ids = group && Array.isArray(group.memberIds) ? group.memberIds : [];
    ids.forEach((id) => {
      set[id] = true;
    });
    return set;
  }

  function renderPeople() {
    const previously = {};
    peopleEl.querySelectorAll("input[type=checkbox]").forEach((box) => {
      if (box.checked && !box.disabled) previously[box.getAttribute("data-user-id")] = true;
    });
    clear(peopleEl);
    const members = memberSet();
    if (!people.length) {
      peopleEl.append(h("p", { class: "hint", text: "No one has been invited yet." }));
      return;
    }
    people.forEach((person) => {
      const connected = person.token_status === "ok";
      const inGroup = !!members[person.id];
      const box = h("input", { type: "checkbox" });
      box.disabled = !connected || inGroup;
      box.checked = inGroup || !!previously[person.id];
      box.setAttribute("data-user-id", String(person.id));
      const display = person.name || person.email || "Person";
      const bits = [];
      if (person.name && person.email) bits.push(person.email);
      bits.push(roleText(person.role));
      if (inGroup) bits.push("Included with the group");
      if (!connected) bits.push("Calendar not connected");
      const copy = h("span", { class: "check-copy" });
      copy.append(h("span", { class: "check-title", text: display }));
      copy.append(h("span", { class: "sub", text: bits.filter(Boolean).join(" · ") }));
      const label = h("label", { class: "check-row" + (connected ? "" : " is-disabled") });
      label.append(box, copy, pill(statusText(person.token_status), statusTone(person.token_status)));
      peopleEl.append(label);
    });
  }

  function renderSlots(data) {
    clear(results);
    const slots = Array.isArray(data.slots) ? data.slots : [];
    let currentDay = "";
    let group = null;
    slots.forEach((slot) => {
      const startCt = String(slot.startCt || "");
      const endCt = String(slot.endCt || "");
      const parts = startCt.split(", ");
      let day = startCt;
      let time = startCt;
      if (parts.length >= 2 && /[AP]M/.test(parts[parts.length - 1])) {
        day = parts.slice(0, parts.length - 1).join(", ");
        time = parts[parts.length - 1];
      }
      const endParts = endCt.split(", ");
      let endTime = endCt;
      if (endParts.length >= 2 && /[AP]M/.test(endParts[endParts.length - 1])) {
        endTime = endParts[endParts.length - 1];
      }
      if (day !== currentDay) {
        currentDay = day;
        group = h("div", { class: "day-group" });
        group.append(h("h3", { text: day }));
        results.append(group);
      }
      const row = h("div", { class: "slot" });
      row.append(h("span", { class: "slot-time", text: time + " – " + endTime }));
      row.append(h("span", { class: "sub", text: tz }));
      if (group) group.append(row);
    });
  }

  Promise.all([getJson("/api/people"), getJson("/api/groups")])
    .then((pair) => {
      people = Array.isArray(pair[0].people) ? pair[0].people : [];
      groups = Array.isArray(pair[1].groups) ? pair[1].groups : [];
      groups.forEach((group) => {
        groupEl.append(h("option", { value: group.id, text: group.name || "Group" }));
      });
      groupEl.addEventListener("change", renderPeople);
      renderPeople();
    })
    .catch((err) => {
      setBanner(msg, "bad", err.message || "Could not load people");
    });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const startDate = start.value;
    const endDate = end.value;
    const span = inclusiveDaySpan(startDate, endDate);
    if (span == null) {
      setBanner(msg, "bad", "Choose a start date on or before the end date.");
      return;
    }
    if (span > 14) {
      setBanner(msg, "bad", "Choose 14 days or fewer.");
      return;
    }
    const duration = Number(document.getElementById("duration").value);
    const winStart = parseTimeToMinutes(document.getElementById("window-start").value);
    const winEnd = parseTimeToMinutes(document.getElementById("window-end").value);
    if (winStart == null || winEnd == null || winEnd <= winStart) {
      setBanner(msg, "bad", "The daily window needs an end time after the start.");
      return;
    }
    const members = memberSet();
    const userIds = [];
    peopleEl.querySelectorAll("input[type=checkbox]").forEach((box) => {
      if (!box.checked || box.disabled) return;
      const id = box.getAttribute("data-user-id");
      if (id && !members[id]) userIds.push(id);
    });
    const groupId = groupEl.value || "";
    if (!groupId && userIds.length === 0) {
      setBanner(msg, "bad", "Select at least one person or a saved group.");
      return;
    }
    const picked = people.filter((p) => members[p.id] || userIds.indexOf(p.id) !== -1);
    const missing = picked.filter((p) => p.token_status !== "ok");
    if (missing.length) {
      setBanner(
        msg,
        "bad",
        "Calendar not connected for " + missing.map((p) => p.email).join(", ") + ".",
      );
      return;
    }
    let rangeStart = "";
    let rangeEnd = "";
    try {
      rangeStart = zonedWallTimeToIso(startDate, 0, 0, tz);
      rangeEnd = zonedWallTimeToIso(addDays(endDate, 1), 0, 0, tz);
    } catch (err) {
      setBanner(msg, "bad", "Those dates could not be read.");
      return;
    }
    if (Date.parse(rangeEnd) - Date.parse(rangeStart) > 14 * 86400000) {
      setBanner(msg, "bad", "That range is longer than 14 days in Central Time. Shorten it by a day.");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    clear(results);
    setBanner(msg, "", "");
    const payload = {
      userIds: userIds,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
      durationMinutes: duration,
      windowStartMinutes: winStart,
      windowEndMinutes: winEnd,
    };
    if (groupId) payload.groupId = groupId;
    send("POST", "/api/slots", payload)
      .then((data) => {
        renderSlots(data);
        const count = data.slots ? data.slots.length : 0;
        if (!count) {
          setBanner(msg, "", "No overlapping free time in that window. Try more days or fewer people.");
        } else if (count >= 50) {
          setBanner(msg, "", "Showing 50 available times. Narrow the window for a shorter list.");
        }
      })
      .catch((err) => {
        setBanner(msg, "bad", err.message || "Could not load available times");
      })
      .then(() => {
        button.disabled = false;
      });
  });
}

function initAdmin() {
  const root = document.getElementById("admin-app");
  if (!root) return;
  const inviteForm = document.getElementById("invite-form");
  const inviteMsg = document.getElementById("invite-msg");
  const roster = document.getElementById("roster-list");
  const groupForm = document.getElementById("group-create-form");
  const groupList = document.getElementById("group-list");
  const groupMsg = document.getElementById("group-msg");
  const accessStatus = document.getElementById("access-status");
  const accessBtn = document.getElementById("access-sync-btn");
  const accessMsg = document.getElementById("access-msg");
  const googleLists = document.getElementById("google-lists");
  const googleMsg = document.getElementById("google-msg");
  let users = [];
  let groups = [];

  const settingsForm = document.getElementById("heatmap-settings-form");
  const settingsMsg = document.getElementById("heatmap-settings-msg");
  if (settingsForm) {
    const dayInput = document.getElementById("heat-day-count");
    const weekendInput = document.getElementById("heat-show-weekends");
    const startInput = document.getElementById("heat-admin-start");
    const endInput = document.getElementById("heat-admin-end");
    getJson("/api/heatmap-settings").then((data) => {
      if (dayInput && Number.isInteger(data.dayCount)) dayInput.value = String(data.dayCount);
      if (weekendInput) weekendInput.value = data.showWeekends ? "yes" : "no";
      if (startInput && Number.isInteger(data.windowStartMinutes)) {
        startInput.value = String(data.windowStartMinutes);
      }
      if (endInput && Number.isInteger(data.windowEndMinutes)) {
        endInput.value = String(data.windowEndMinutes);
      }
    }).catch((err) => {
      setBanner(settingsMsg, "bad", err.message || "Could not load heatmap settings");
    });
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const button = settingsForm.querySelector("button[type=submit]");
      button.disabled = true;
      send("POST", "/api/admin/heatmap-settings", {
        dayCount: Number(dayInput.value),
        showWeekends: weekendInput.value === "yes",
        windowStartMinutes: Number(startInput.value),
        windowEndMinutes: Number(endInput.value),
      }).then(() => {
        setBanner(settingsMsg, "ok", "Saved. Home uses these rules for everyone.");
      }).catch((err) => {
        setBanner(settingsMsg, "bad", err.message || "Could not save heatmap settings");
      }).then(() => {
        button.disabled = false;
      });
    });
  }

  function metric(label, value) {
    const wrap = h("div", { class: "metric" });
    wrap.append(h("div", { class: "metric-label", text: label }));
    wrap.append(h("div", { class: "metric-value", text: value }));
    return wrap;
  }

  function renderRoster() {
    clear(roster);
    if (!users.length) {
      roster.append(h("p", { class: "hint", text: "No invited people yet." }));
      return;
    }
    users.forEach((user) => {
      const row = h("div", { class: "person" });
      const copy = h("div", {});
      copy.append(h("div", { class: "check-title", text: user.email || "" }));
      const meta = h("div", { class: "meta" });
      meta.append(pill(roleText(user.role), user.role === "admin" ? "ok" : ""));
      meta.append(pill(statusText(user.token_status), statusTone(user.token_status)));
      if (user.last_login_at) {
        meta.append(h("span", { class: "sub", text: "Last sign-in " + formatWhen(user.last_login_at) }));
      }
      copy.append(meta);
      const actions = h("div", { class: "row" });
      const role = h("select", { "aria-label": "Role for " + (user.email || "person") });
      ["host", "producer", "guest", "admin"].forEach((r) => {
        const opt = h("option", { value: r, text: roleText(r) });
        if (r === user.role) opt.selected = true;
        role.append(opt);
      });
      const save = h("button", { class: "btn", type: "button", text: "Save role" });
      save.addEventListener("click", () => {
        save.disabled = true;
        send("POST", "/api/admin/role", { userId: user.id, role: role.value })
          .then(() => {
            setBanner(inviteMsg, "ok", "Updated role for " + user.email + ".");
            return refresh();
          })
          .catch((err) => {
            setBanner(inviteMsg, "bad", err.message || "Could not update role");
            save.disabled = false;
          });
      });
      const isSelf = String(user.email || "").toLowerCase() === selfEmail;
      const remove = h("button", { class: "btn btn-danger", type: "button", text: "Remove" });
      if (isSelf) {
        remove.disabled = true;
        remove.setAttribute("title", "You cannot remove yourself");
      } else {
        remove.addEventListener("click", () => {
          if (!confirm("Remove " + user.email + " from the invite list? This deletes their stored data.")) return;
          remove.disabled = true;
          send("POST", "/api/admin/remove", { userId: user.id, email: user.email })
            .then(() => {
              setBanner(inviteMsg, "ok", "Removed " + user.email + ".");
              return refresh();
            })
            .catch((err) => {
              setBanner(inviteMsg, "bad", err.message || "Could not remove");
              remove.disabled = false;
            });
        });
      }
      actions.append(role, save, remove);
      row.append(copy, actions);
      roster.append(row);
    });
  }

  function renderGroups() {
    clear(groupList);
    if (!groups.length) {
      groupList.append(h("p", { class: "hint", text: "No saved groups yet." }));
      return;
    }
    groups.forEach((group) => {
      const card = h("article", { class: "subcard" });
      const nameForm = h("form", { class: "form-row" });
      const nameInput = h("input", {
        type: "text",
        value: group.name || "",
        maxlength: "80",
        required: "true",
        "aria-label": "Group name",
      });
      const rename = h("button", { class: "btn", type: "submit", text: "Rename" });
      const del = h("button", { class: "btn btn-danger", type: "button", text: "Delete" });
      nameForm.append(nameInput, rename, del);
      nameForm.addEventListener("submit", (e) => {
        e.preventDefault();
        send("POST", "/api/groups/rename", { groupId: group.id, name: nameInput.value })
          .then(() => {
            setBanner(groupMsg, "ok", "Renamed group.");
            return refresh();
          })
          .catch((err) => setBanner(groupMsg, "bad", err.message || "Could not rename"));
      });
      del.addEventListener("click", () => {
        if (!confirm("Delete the group " + (group.name || "") + "?")) return;
        send("POST", "/api/groups/delete", { groupId: group.id })
          .then(() => {
            setBanner(groupMsg, "ok", "Deleted group.");
            return refresh();
          })
          .catch((err) => setBanner(groupMsg, "bad", err.message || "Could not delete"));
      });
      const members = h("div", { class: "row" });
      const ids = Array.isArray(group.memberIds) ? group.memberIds : [];
      if (!ids.length) members.append(h("p", { class: "hint", text: "No members yet." }));
      ids.forEach((id) => {
        const user = users.find((u) => u.id === id);
        const label = user ? user.email : id;
        const chip = h("span", { class: "chip" });
        chip.append(h("span", { text: label }));
        const x = h("button", { type: "button", text: "×", "aria-label": "Remove " + label });
        x.addEventListener("click", () => {
          send("POST", "/api/groups/members/remove", { groupId: group.id, userId: id })
            .then(() => refresh())
            .catch((err) => setBanner(groupMsg, "bad", err.message || "Could not remove member"));
        });
        chip.append(x);
        members.append(chip);
      });
      const addForm = h("form", { class: "form-row" });
      const sel = h("select", { "aria-label": "Person to add" });
      sel.append(h("option", { value: "", text: "Add a person" }));
      users.forEach((u) => {
        if (ids.indexOf(u.id) !== -1) return;
        sel.append(h("option", { value: u.id, text: u.email }));
      });
      const addBtn = h("button", { class: "btn", type: "submit", text: "Add member" });
      addForm.append(sel, addBtn);
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!sel.value) return;
        send("POST", "/api/groups/members/add", { groupId: group.id, userId: sel.value })
          .then(() => {
            setBanner(groupMsg, "ok", "Added member.");
            return refresh();
          })
          .catch((err) => setBanner(groupMsg, "bad", err.message || "Could not add member"));
      });
      card.append(nameForm, members, addForm);
      groupList.append(card);
    });
  }

  function renderAccess(data) {
    clear(accessStatus);
    const configured = !!(data && data.configured);
    const state = (data && data.state) || {};
    const grid = h("div", { class: "metrics metrics-tight" });
    grid.append(metric("Configured", configured ? "Yes" : "No"));
    grid.append(metric("Last status", state.last_status || "None yet"));
    grid.append(metric("Last success", state.last_success_at || "None yet"));
    accessStatus.append(grid);
    if (!configured) {
      accessStatus.append(h("p", {
        class: "hint",
        text: "Sync stays inactive until the Access API token is configured. The invite list is still the source of truth.",
      }));
    }
    if (state.last_error) {
      const err = h("p", { class: "banner banner-bad", text: String(state.last_error) });
      accessStatus.append(err);
    }
    if (state.last_emails_json) {
      try {
        const emails = JSON.parse(state.last_emails_json);
        if (Array.isArray(emails) && emails.length) {
          accessStatus.append(h("p", {
            class: "hint",
            text: "Last synced emails: " + emails.map((email) => String(email)).join(", "),
          }));
        }
      } catch (e) {
        /* bookkeeping was not a JSON list */
      }
    }
  }

  function googleCol(title, emails, action, path) {
    const col = h("div", { class: "stack-sm" });
    col.append(h("h3", { text: title }));
    const list = Array.isArray(emails) ? emails : [];
    if (!list.length) {
      col.append(h("p", { class: "hint", text: "None" }));
      return col;
    }
    list.forEach((email) => {
      const row = h("div", { class: "check-row" });
      row.append(h("span", { class: "check-title", text: String(email) }));
      if (action && path) {
        const btn = h("button", { class: "btn", type: "button", text: action });
        btn.addEventListener("click", () => {
          btn.disabled = true;
          send("POST", path, { email: email })
            .then(() => {
              setBanner(googleMsg, "ok", "Updated the checklist for " + email + ". Google Cloud itself was not changed from here.");
              return refreshGoogle();
            })
            .catch((err) => {
              setBanner(googleMsg, "bad", err.message || "Could not update the checklist");
              btn.disabled = false;
            });
        });
        row.append(btn);
      } else {
        row.append(pill("In sync", "ok"));
      }
      col.append(row);
    });
    return col;
  }

  function renderGoogle(data) {
    clear(googleLists);
    const grid = h("div", { class: "grid-3" });
    grid.append(googleCol("To add", data && data.toAdd, "Mark added", "/api/admin/google-test-users/ack"));
    grid.append(googleCol("To remove", data && data.toRemove, "Mark removed", "/api/admin/google-test-users/unack"));
    grid.append(googleCol("In sync", data && data.inSync, "", ""));
    googleLists.append(grid);
  }

  function refreshGoogle() {
    return getJson("/api/admin/google-test-users").then((data) => {
      renderGoogle(data);
    });
  }

  function refresh() {
    return Promise.all([
      getJson("/api/admin/users"),
      getJson("/api/groups"),
      getJson("/api/admin/access-sync"),
    ]).then((triple) => {
      users = Array.isArray(triple[0].users) ? triple[0].users : [];
      groups = Array.isArray(triple[1].groups) ? triple[1].groups : [];
      renderRoster();
      renderGroups();
      renderAccess(triple[2]);
      return refreshGoogle();
    });
  }

  inviteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("invite-email");
    const role = document.getElementById("invite-role").value;
    const email = emailInput.value.trim();
    const btn = inviteForm.querySelector("button[type=submit]");
    btn.disabled = true;
    send("POST", "/api/admin/invite", { email: email, role: role })
      .then((data) => {
        emailInput.value = "";
        const hint = data && data.googleTestUsersHint ? " " + data.googleTestUsersHint : "";
        setBanner(inviteMsg, "ok", "Invited " + email + "." + hint);
        return refresh();
      })
      .catch((err) => {
        setBanner(inviteMsg, "bad", err.message || "Could not invite");
      })
      .then(() => {
        btn.disabled = false;
      });
  });

  groupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("group-name");
    send("POST", "/api/groups", { name: input.value })
      .then(() => {
        input.value = "";
        setBanner(groupMsg, "ok", "Created group.");
        return refresh();
      })
      .catch((err) => setBanner(groupMsg, "bad", err.message || "Could not create group"));
  });

  accessBtn.addEventListener("click", () => {
    if (!confirm("Sync Cloudflare Access to the current invite list?")) return;
    accessBtn.disabled = true;
    send("POST", "/api/admin/access-sync", {})
      .then((data) => {
        const result = (data && data.result) || {};
        if (result.status === "ok") {
          setBanner(accessMsg, "ok", "Access policy updated to match the invite list.");
        } else if (result.status === "skipped") {
          setBanner(accessMsg, "", result.error || "Access sync is inactive.");
        } else {
          setBanner(accessMsg, "bad", result.error || "Access sync failed.");
        }
        return getJson("/api/admin/access-sync").then(renderAccess);
      })
      .catch((err) => setBanner(accessMsg, "bad", err.message || "Access sync failed"))
      .then(() => {
        accessBtn.disabled = false;
      });
  });

  refresh().catch((err) => {
    setBanner(inviteMsg, "bad", err.message || "Could not load admin data");
  });
}

if (page === "home" || page === "delete") initHome();
if (page === "home") initHeat();
if (page === "calendars") initCalendars();
if (page === "times") initTimes();
if (page === "admin") initAdmin();
})();`;
}
