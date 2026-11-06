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

function heatFill(freeCount, sharedCount) {
  if (sharedCount <= 0) return "";
  if (freeCount <= 0) return HEAT_STOPS[0];
  const t = freeCount / sharedCount;
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
    defaultGroupName: "Hosts",
  };
  let people = [];
  let groups = [];
  let pickedIds = {};
  let groupIds = {};
  let ranges = [];
  let drag = null;
  let heatTimer = null;
  let heatAbort = null;
  let committedStart = "";
  let committedEnd = "";
  let rangePreset = "next";
  let draftStart = "";
  let draftEnd = "";
  let draftPreset = "next";
  let pickingEnd = false;
  let viewMonth = "";
  let hoverFromTouch = false;

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
    if (data && typeof data.defaultGroupName === "string") {
      heatSettings.defaultGroupName = data.defaultGroupName;
    }
    const unit = heatSettings.showWeekends
      ? "days, including weekends"
      : "business days, skipping Saturday and Sunday";
    if (rulesEl) {
      rulesEl.textContent =
        "Hover or tap a time to see who is free, busy, or not shared. " +
        formatMinutes(heatSettings.windowStartMinutes) +
        "–" +
        formatMinutes(heatSettings.windowEndMinutes) +
        " Central. Next week follows the saved count of " +
        heatSettings.dayCount +
        " " +
        unit +
        ". Custom ranges can cover up to 14 days.";
    }
    if (rangePreset === "next" || !committedStart) {
      const preset = nextWeekRange();
      committedStart = preset.start;
      committedEnd = preset.end;
      rangePreset = "next";
      updateRangeTrigger();
    }
  }

  function isoParts(iso) {
    const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso || "");
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
      return null;
    }
    return { year: year, month: month, day: day };
  }

  function formatDay(iso) {
    const parts = isoParts(iso);
    if (!parts) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
  }

  function monthTitle(iso) {
    const parts = isoParts(iso);
    if (!parts) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(parts.year, parts.month - 1, 1, 12)));
  }

  function monthKey(iso) {
    const parts = isoParts(iso);
    if (!parts) return "";
    const mo = parts.month < 10 ? "0" + parts.month : String(parts.month);
    return parts.year + "-" + mo + "-01";
  }

  function shiftMonth(iso, delta) {
    const parts = isoParts(iso);
    if (!parts) return iso;
    const dt = new Date(Date.UTC(parts.year, parts.month - 1 + delta, 1));
    const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
    return dt.getUTCFullYear() + "-" + mo + "-01";
  }

  const MONTH_INDEX = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  function parseDay(text) {
    const raw = String(text || "").trim();
    let m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(raw);
    if (m && isoParts(m[0])) return m[0];
    m = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/.exec(raw);
    if (m) {
      const iso = m[3] + "-" + String(m[1]).padStart(2, "0") + "-" + String(m[2]).padStart(2, "0");
      if (isoParts(iso)) return iso;
    }
    m = /^([A-Za-z]+)\\.?\\s+(\\d{1,2}),\\s*(\\d{4})$/.exec(raw);
    if (m && MONTH_INDEX[m[1].toLowerCase()]) {
      const iso = m[3] + "-" + String(MONTH_INDEX[m[1].toLowerCase()]).padStart(2, "0") + "-" + String(m[2]).padStart(2, "0");
      if (isoParts(iso)) return iso;
    }
    return "";
  }

  function nextWeekRange() {
    const count = heatSettings.dayCount || 5;
    const today = chicagoToday();
    const from = heatSettings.showWeekends ? today : rollToWeekday(today);
    const end = heatSettings.showWeekends
      ? addDays(from, Math.max(0, count - 1))
      : addBusinessDays(from, Math.max(0, count - 1));
    return { start: from, end: end };
  }

  function updateRangeTrigger() {
    const label = document.getElementById("heat-range-label");
    if (!label) return;
    if (rangePreset === "next") label.textContent = "Next week";
    else if (committedStart && committedEnd) {
      label.textContent = formatDay(committedStart) + " – " + formatDay(committedEnd);
    } else label.textContent = "Custom range";
  }

  function setRangeNote(text) {
    const note = document.getElementById("heat-range-note");
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || "";
  }

  function renderMonths() {
    const host = document.getElementById("heat-months");
    if (!host) return;
    clear(host);
    if (!viewMonth) viewMonth = monthKey(draftStart || chicagoToday());
    [0, 1].forEach((offset) => {
      const monthIso = shiftMonth(viewMonth, offset);
      const parts = isoParts(monthIso);
      const month = h("div", { class: "range-month" });
      const head = h("div", { class: "range-month-head" });
      if (offset === 0) {
        const prev = h("button", { type: "button", class: "range-nav", text: "‹", "aria-label": "Previous month" });
        prev.addEventListener("click", () => {
          viewMonth = shiftMonth(viewMonth, -1);
          renderMonths();
        });
        head.append(prev);
      } else head.append(h("span", { class: "range-nav-spacer" }));
      head.append(h("span", { text: monthTitle(monthIso) }));
      if (offset === 1) {
        const next = h("button", { type: "button", class: "range-nav", text: "›", "aria-label": "Next month" });
        next.addEventListener("click", () => {
          viewMonth = shiftMonth(viewMonth, 1);
          renderMonths();
        });
        head.append(next);
      } else head.append(h("span", { class: "range-nav-spacer" }));
      month.append(head);
      const dow = h("div", { class: "range-dow" });
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((name) => dow.append(h("span", { text: name })));
      month.append(dow);
      const days = h("div", { class: "range-days" });
      const firstDow = weekdayIndex(monthIso);
      let cursor = addDays(monthIso, -(firstDow || 0));
      for (let i = 0; i < 42; i += 1) {
        const iso = cursor;
        const info = isoParts(iso);
        const inMonth = info && parts && info.month === parts.month;
        const inRange = draftStart && draftEnd && iso >= draftStart && iso <= draftEnd;
        const isStart = iso === draftStart;
        const isEnd = iso === draftEnd;
        let cls = "range-day";
        if (!inMonth) cls += " is-outside";
        if (inRange) cls += " is-inrange";
        if (isStart) cls += " is-start";
        if (isEnd) cls += " is-end";
        if (isStart || isEnd) cls += " is-endpoint";
        const btn = h("button", { type: "button", class: cls, "aria-label": formatDay(iso) });
        btn.setAttribute("data-date", iso);
        if (isStart || isEnd) btn.setAttribute("aria-pressed", "true");
        btn.append(h("span", { text: info ? String(info.day) : "" }));
        btn.addEventListener("click", () => pickDay(iso));
        days.append(btn);
        cursor = addDays(cursor, 1);
      }
      month.append(days);
      host.append(month);
    });
  }

  function syncRangeDraft() {
    const startField = document.getElementById("heat-range-start");
    const endField = document.getElementById("heat-range-end");
    if (startField) startField.value = formatDay(draftStart);
    if (endField) endField.value = formatDay(draftEnd);
    document.querySelectorAll(".range-preset").forEach((btn) => {
      const on = btn.getAttribute("data-preset") === draftPreset;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderMonths();
  }

  function clampDraft() {
    if (draftPreset !== "custom") {
      setRangeNote("");
      return;
    }
    const span = inclusiveDaySpan(draftStart, draftEnd);
    if (span != null && span > 14) {
      draftEnd = addDays(draftStart, 13);
      setRangeNote("Custom ranges stop at 14 days.");
      return;
    }
    setRangeNote("");
  }

  function readRangeFields() {
    const startField = document.getElementById("heat-range-start");
    const endField = document.getElementById("heat-range-end");
    const parsedStart = parseDay(startField && startField.value);
    const parsedEnd = parseDay(endField && endField.value);
    if (parsedStart) draftStart = parsedStart;
    if (parsedEnd) draftEnd = parsedEnd;
    if (draftStart && draftEnd && draftEnd < draftStart) {
      const swap = draftStart;
      draftStart = draftEnd;
      draftEnd = swap;
    }
  }

  function pickDay(iso) {
    draftPreset = "custom";
    if (!pickingEnd || !draftStart) {
      draftStart = iso;
      draftEnd = iso;
      pickingEnd = true;
    } else if (iso < draftStart) {
      draftEnd = draftStart;
      draftStart = iso;
      pickingEnd = false;
    } else {
      draftEnd = iso;
      pickingEnd = false;
    }
    clampDraft();
    syncRangeDraft();
  }

  function openRange() {
    const pop = document.getElementById("heat-range-popover");
    const trigger = document.getElementById("heat-range-trigger");
    if (!pop || !trigger) return;
    draftStart = committedStart;
    draftEnd = committedEnd;
    draftPreset = rangePreset;
    pickingEnd = false;
    viewMonth = monthKey(draftStart || chicagoToday());
    setRangeNote("");
    syncRangeDraft();
    pop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeRange(revert) {
    const pop = document.getElementById("heat-range-popover");
    const trigger = document.getElementById("heat-range-trigger");
    if (pop) pop.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (revert) {
      draftStart = committedStart;
      draftEnd = committedEnd;
      draftPreset = rangePreset;
      setRangeNote("");
    }
  }

  function applyRange() {
    readRangeFields();
    if (draftPreset === "next") {
      const preset = nextWeekRange();
      draftStart = preset.start;
      draftEnd = preset.end;
    }
    if (!draftStart || !draftEnd || draftStart > draftEnd) {
      setRangeNote("Choose a start date on or before the end date.");
      return;
    }
    clampDraft();
    committedStart = draftStart;
    committedEnd = draftEnd;
    rangePreset = draftPreset;
    updateRangeTrigger();
    closeRange(false);
    scheduleHeat();
  }

  function bindRangePicker() {
    const trigger = document.getElementById("heat-range-trigger");
    const pop = document.getElementById("heat-range-popover");
    const root = document.getElementById("heat-range");
    const form = document.getElementById("heat-form");
    if (form) form.addEventListener("submit", (e) => e.preventDefault());
    if (!committedStart) {
      const preset = nextWeekRange();
      committedStart = preset.start;
      committedEnd = preset.end;
      rangePreset = "next";
      updateRangeTrigger();
    }
    if (!trigger || !pop) return;
    trigger.addEventListener("click", () => {
      if (pop.hidden) openRange();
      else closeRange(true);
    });
    const cancel = document.getElementById("heat-range-cancel");
    const apply = document.getElementById("heat-range-apply");
    if (cancel) cancel.addEventListener("click", () => closeRange(true));
    if (apply) apply.addEventListener("click", applyRange);
    document.querySelectorAll(".range-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.getAttribute("data-preset");
        if (preset === "next") {
          const range = nextWeekRange();
          draftPreset = "next";
          draftStart = range.start;
          draftEnd = range.end;
          pickingEnd = false;
          viewMonth = monthKey(draftStart);
          setRangeNote("");
        } else {
          draftPreset = "custom";
          setRangeNote("");
        }
        syncRangeDraft();
      });
    });
    ["heat-range-start", "heat-range-end"].forEach((id) => {
      const field = document.getElementById(id);
      if (!field) return;
      field.addEventListener("change", () => {
        draftPreset = "custom";
        readRangeFields();
        clampDraft();
        syncRangeDraft();
      });
    });
    document.addEventListener("mousedown", (e) => {
      if (pop.hidden) return;
      if (root && root.contains(e.target)) return;
      closeRange(true);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pop && !pop.hidden) closeRange(true);
    });
  }

  function selectedGroups() {
    return groups.filter((group) => groupIds[group.id]);
  }

  function memberSet() {
    const set = {};
    selectedGroups().forEach((group) => {
      const ids = Array.isArray(group.memberIds) ? group.memberIds : [];
      ids.forEach((id) => {
        set[id] = true;
      });
    });
    return set;
  }

  function renderPeople() {
    const members = memberSet();
    clear(peopleEl);
    selectedGroups().forEach((group) => {
      const name = group.name || "Group";
      const chip = h("span", { class: "chip" });
      chip.append(h("span", { text: name + " (Group)" }));
      const remove = h("button", {
        type: "button",
        text: "×",
        "aria-label": "Remove " + name,
      });
      remove.addEventListener("click", () => {
        delete groupIds[group.id];
        renderPeople();
        scheduleHeat();
      });
      chip.append(remove);
      peopleEl.append(chip);
    });
    people.forEach((person) => {
      if (!pickedIds[person.id]) return;
      const display = person.name || person.email || "Person";
      const chip = h("span", { class: "chip" });
      chip.append(h("span", { text: display }));
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
      peopleEl.append(chip);
    });
    if (groupEl) {
      while (groupEl.options.length > 1) groupEl.remove(1);
      groupEl.options[0].textContent = "Add a group";
      groups.forEach((group) => {
        if (groupIds[group.id]) return;
        groupEl.append(h("option", { value: group.id, text: group.name || "Group" }));
      });
      groupEl.value = "";
    }
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
    Object.keys(members).forEach((id) => userIds.push(id));
    Object.keys(pickedIds).forEach((id) => {
      if (!members[id]) userIds.push(id);
    });
    const picked = people.filter((person) => members[person.id] || pickedIds[person.id]);
    return { userIds: userIds, picked: picked };
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
    const unshared = [];
    (cell.people || []).forEach((person) => {
      const label = person.name || person.email || "Person";
      if (person.status === "unshared") unshared.push(label);
      else if (person.status === "free") free.push(label);
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
    names("Not shared", unshared, "is-busy");
    hover.style.position = "fixed";
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const box = hover.getBoundingClientRect();
    let top = rect.bottom + margin;
    let left = rect.left;
    if (top + box.height > window.innerHeight - margin) {
      top = rect.top - box.height - margin;
    }
    if (left + box.width > window.innerWidth - margin) {
      left = window.innerWidth - box.width - margin;
    }
    hover.style.left = Math.max(margin, left) + "px";
    hover.style.top = Math.max(margin, top) + "px";
  }

  function renderGrid(data) {
    clear(gridEl);
    hideHover();
    const total = typeof data.total === "number" ? data.total : (data.people || []).length;
    setLegend(total);
    const keepWeekends = data.includeWeekends === true || !!heatSettings.showWeekends;
    const days = (Array.isArray(data.days) ? data.days : []).filter((day) => {
      if (keepWeekends) return true;
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
    table.style.minWidth = (64 + days.length * 72) + "px";
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
      const next = rows[rowIndex + 1];
      const tr = h("tr", { class: !next || next.minutes % 60 === 0 ? "hour" : "" });
      tr.append(h("th", {
        class: "heat-time",
        text: row.minutes % 60 === 0 ? row.label : "",
      }));
      days.forEach((day) => {
        const cell = byKey[day.date + ":" + row.minutes] || { people: [], freeCount: 0, label: row.label };
        const button = h("button", { type: "button", class: "heat-cell" });
        const sharedCount = typeof cell.sharedCount === "number"
          ? cell.sharedCount
          : (cell.people || []).filter((person) => person.status !== "unshared").length;
        const fill = heatFill(cell.freeCount || 0, sharedCount);
        if (!fill) button.classList.add("is-unshared");
        else button.style.background = fill;
        button.setAttribute("data-day", day.date);
        button.setAttribute("data-minutes", String(row.minutes));
        button.setAttribute("data-start", cell.start || "");
        button.setAttribute("data-end", cell.end || "");
        button.setAttribute("data-label", cell.label || row.label);
        button.setAttribute("data-day-label", day.label || "");
        button.setAttribute("data-weekday", day.weekday || "");
        button.setAttribute("data-slot", String(data.slotMinutes || 30));
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
        button._heat = enriched;
        button.addEventListener("mouseenter", () => showHover(enriched, button));
        button.addEventListener("focus", () => showHover(enriched, button));
        button.addEventListener("mouseleave", () => {
          if (hoverFromTouch) return;
          hideHover();
        });
        button.addEventListener("blur", () => {
          if (hoverFromTouch) return;
          hideHover();
        });
        const td = h("td", {});
        td.append(button);
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(thead, tbody);
    gridEl.append(table);
    bindSelection(gridEl);
    paintSelection();
  }

  function cellFromButton(button) {
    return {
      day: button.getAttribute("data-day") || "",
      minutes: Number(button.getAttribute("data-minutes")),
      start: button.getAttribute("data-start") || "",
      end: button.getAttribute("data-end") || "",
      label: button.getAttribute("data-label") || "",
      dayLabel: button.getAttribute("data-day-label") || "",
      weekday: button.getAttribute("data-weekday") || "",
      slot: Number(button.getAttribute("data-slot") || "30"),
    };
  }

  function buttonAt(day, minutes) {
    return gridEl.querySelector('.heat-cell[data-day="' + day + '"][data-minutes="' + minutes + '"]');
  }

  function rangeCovers(range, day, minutes) {
    return range.day === day && minutes >= range.startMin && minutes < range.endMin;
  }

  function paintSelection() {
    gridEl.querySelectorAll(".heat-cell").forEach((button) => {
      const day = button.getAttribute("data-day");
      const minutes = Number(button.getAttribute("data-minutes"));
      let on = ranges.some((range) => rangeCovers(range, day, minutes));
      if (drag && drag.day === day) {
        const low = Math.min(drag.anchor, drag.current);
        const high = Math.max(drag.anchor, drag.current);
        if (minutes >= low && minutes <= high) on = true;
      }
      button.classList.toggle("is-selected", on);
    });
    updateCreateBar();
  }

  function addRange(next) {
    const sameDay = ranges.filter((range) => range.day === next.day);
    const others = ranges.filter((range) => range.day !== next.day);
    let startMin = next.startMin;
    let endMin = next.endMin;
    let startIso = next.startIso;
    let endIso = next.endIso;
    const rest = [];
    sameDay.forEach((range) => {
      if (range.endMin < startMin || range.startMin > endMin) {
        rest.push(range);
        return;
      }
      if (range.startMin < startMin) {
        startMin = range.startMin;
        startIso = range.startIso;
      }
      if (range.endMin > endMin) {
        endMin = range.endMin;
        endIso = range.endIso;
      }
    });
    ranges = others.concat(rest, [{
      day: next.day,
      dayLabel: next.dayLabel,
      weekday: next.weekday,
      startMin: startMin,
      endMin: endMin,
      startIso: startIso,
      endIso: endIso,
    }]);
  }

  function commitDrag() {
    if (!drag) return;
    const low = Math.min(drag.anchor, drag.current);
    const high = Math.max(drag.anchor, drag.current);
    const existing = ranges.find((range) => rangeCovers(range, drag.day, drag.anchor));
    if (drag.anchor === drag.current && existing) {
      ranges = ranges.filter((range) => range !== existing);
    } else {
      const startBtn = buttonAt(drag.day, low);
      const endBtn = buttonAt(drag.day, high);
      if (startBtn && endBtn) {
        addRange({
          day: drag.day,
          dayLabel: drag.dayLabel,
          weekday: drag.weekday,
          startMin: low,
          endMin: high + drag.slot,
          startIso: startBtn.getAttribute("data-start"),
          endIso: endBtn.getAttribute("data-end"),
        });
      }
    }
    drag = null;
    paintSelection();
  }

  function bindSelection(host) {
    host.addEventListener("pointerdown", (e) => {
      const button = e.target.closest(".heat-cell");
      if (!button || e.button !== 0) return;
      if (e.pointerType === "touch") {
        hoverFromTouch = true;
        if (button._heat) showHover(button._heat, button);
        return;
      }
      hoverFromTouch = false;
      e.preventDefault();
      const info = cellFromButton(button);
      drag = {
        day: info.day,
        anchor: info.minutes,
        current: info.minutes,
        dayLabel: info.dayLabel,
        weekday: info.weekday,
        slot: info.slot,
      };
      host.setPointerCapture(e.pointerId);
      paintSelection();
    });
    host.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const button = document.elementFromPoint(e.clientX, e.clientY);
      const cell = button && button.closest ? button.closest(".heat-cell") : null;
      if (!cell || cell.getAttribute("data-day") !== drag.day) return;
      drag.current = Number(cell.getAttribute("data-minutes"));
      paintSelection();
    });
    host.addEventListener("pointerup", () => commitDrag());
    host.addEventListener("pointercancel", () => {
      drag = null;
      paintSelection();
    });
  }

  function rangeText(range) {
    const startBtn = buttonAt(range.day, range.startMin);
    const endMinutes = range.endMin;
    const endLabel = clockLabel(endMinutes);
    const startLabel = startBtn ? startBtn.getAttribute("data-label") : clockLabel(range.startMin);
    return range.weekday + " " + range.dayLabel + " " + startLabel + "–" + endLabel;
  }

  function updateCreateBar() {
    const bar = document.getElementById("heat-create");
    const summary = document.getElementById("heat-create-summary");
    if (!bar || !summary) return;
    if (!ranges.length) {
      bar.hidden = true;
      const confirm = document.getElementById("heat-confirm");
      if (confirm) confirm.hidden = true;
      summary.textContent = "";
      return;
    }
    bar.hidden = false;
    summary.textContent = ranges.map(rangeText).join("; ");
  }

  function selectedPeople() {
    return selectedIds().picked;
  }

  function reviewEvent() {
    const titleInput = document.getElementById("heat-title");
    const title = titleInput ? titleInput.value.trim() : "";
    if (!title) {
      setBanner(msg, "bad", "Add a title before creating the event.");
      return;
    }
    if (!ranges.length) {
      setBanner(msg, "bad", "Select a time on the calendar first.");
      return;
    }
    const people = selectedPeople();
    if (!people.length) {
      setBanner(msg, "bad", "Select at least one person.");
      return;
    }
    const missingEmail = people.filter((person) => !person.email);
    if (missingEmail.length) {
      setBanner(msg, "bad", "A selected person has no email, so they cannot be invited.");
      return;
    }
    if (document.body.getAttribute("data-calendar") !== "ok") {
      setBanner(msg, "bad", "Connect Google Calendar before creating an event.");
      return;
    }
    const list = document.getElementById("heat-confirm-list");
    const copy = document.getElementById("heat-confirm-copy");
    clear(list);
    ranges.forEach((range) => list.append(h("li", { text: rangeText(range) })));
    const names = people.map((person) => person.name || person.email).join(", ");
    copy.textContent = "Create " + ranges.length + " event" + (ranges.length === 1 ? "" : "s") +
      " titled “" + title + "” on your calendar for " + names + ".";
    document.getElementById("heat-confirm").hidden = false;
    setBanner(msg, "", "");
  }

  function createEvents() {
    const title = document.getElementById("heat-title").value.trim();
    const people = selectedPeople();
    const button = document.getElementById("heat-confirm-go");
    button.disabled = true;
    loadMe(false).then((me) => {
      if (!me.canCreateEvents) {
        setBanner(msg, "bad", "Reconnect Google Calendar to create events. The current connection can only read free/busy.");
        const link = h("a", { href: "/auth/google/calendar/start", text: "Reconnect Google Calendar" });
        document.getElementById("heat-msg").append(document.createTextNode(" "));
        document.getElementById("heat-msg").append(link);
        button.disabled = false;
        return;
      }
      return send("POST", "/api/events", {
        title: title,
        ranges: ranges.map((range) => ({ start: range.startIso, end: range.endIso })),
        userIds: people.map((person) => person.id),
      }).then((data) => {
        const count = data.created ? data.created.length : ranges.length;
        setBanner(msg, "ok", "Created " + count + " event" + (count === 1 ? "" : "s") + " on your calendar. Invites go to the other selected people.");
        ranges = [];
        document.getElementById("heat-title").value = "";
        document.getElementById("heat-confirm").hidden = true;
        paintSelection();
      });
    }).catch((err) => {
      const text = (err && err.message) || "Could not create the event";
      setBanner(msg, "bad", text);
      if (text.indexOf("Reconnect Google Calendar") !== -1) {
        const link = h("a", { href: "/auth/google/calendar/start", text: "Reconnect Google Calendar" });
        document.getElementById("heat-msg").append(document.createTextNode(" "));
        document.getElementById("heat-msg").append(link);
      }
    }).then(() => {
      button.disabled = false;
    });
  }

  function clearBoard(hint) {
    if (heatAbort) heatAbort.abort();
    heatAbort = null;
    ranges = [];
    drag = null;
    clear(gridEl);
    hideHover();
    const confirm = document.getElementById("heat-confirm");
    if (confirm) confirm.hidden = true;
    updateCreateBar();
    if (hint) gridEl.append(h("p", { class: "hint", text: hint }));
  }

  function loadHeat() {
    const sel = selectedIds();
    setLegend(sel.picked.length);
    if (!sel.picked.length) {
      clearBoard("Select people or a saved group.");
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
    if (!committedStart || !committedEnd || committedStart > committedEnd) {
      setBanner(msg, "bad", "Choose a start date on or before the end date.");
      return;
    }
    const custom = rangePreset === "custom";
    if (custom) {
      const span = inclusiveDaySpan(committedStart, committedEnd);
      if (span == null) {
        setBanner(msg, "bad", "Choose a start date on or before the end date.");
        return;
      }
      if (span > 14) {
        setBanner(msg, "bad", "Custom ranges stop at 14 days.");
        return;
      }
    } else {
      const included = includedDayCount(committedStart, committedEnd);
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
    }
    let rangeStart = "";
    let rangeEnd = "";
    try {
      rangeStart = zonedWallTimeToIso(committedStart, 0, 0, tz);
      rangeEnd = zonedWallTimeToIso(addDays(committedEnd, 1), 0, 0, tz);
    } catch (err) {
      setBanner(msg, "bad", "Those dates could not be read.");
      return;
    }
    if (heatAbort) heatAbort.abort();
    heatAbort = new AbortController();
    const signal = heatAbort.signal;
    setBanner(msg, "", "");
    const payload = {
      userIds: sel.picked.map((person) => person.id),
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
      includeWeekends: custom ? true : !!heatSettings.showWeekends,
    };
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
      clear(gridEl);
      hideHover();
      ranges = [];
      drag = null;
      updateCreateBar();
      setBanner(msg, "bad", (err && err.message) || "Could not load availability");
    });
  }

  function scheduleHeat() {
    clearTimeout(heatTimer);
    heatTimer = setTimeout(loadHeat, 200);
  }

  bindRangePicker();
  document.addEventListener("pointerdown", (e) => {
    if (!hoverFromTouch) return;
    const target = e.target;
    if (target && target.closest && target.closest(".heat-cell")) return;
    hoverFromTouch = false;
    hideHover();
  });
  if (groupEl) {
    groupEl.addEventListener("change", () => {
      const id = groupEl.value;
      if (!id) return;
      groupIds[id] = true;
      renderPeople();
      scheduleHeat();
    });
  }
  if (personEl) {
    personEl.addEventListener("change", () => {
      const id = personEl.value;
      if (!id) return;
      pickedIds[id] = true;
      renderPeople();
      scheduleHeat();
    });
  }
  const reviewBtn = document.getElementById("heat-review");
  const clearBtn = document.getElementById("heat-clear");
  const confirmBtn = document.getElementById("heat-confirm-go");
  const backBtn = document.getElementById("heat-confirm-back");
  if (reviewBtn) reviewBtn.addEventListener("click", reviewEvent);
  if (clearBtn) clearBtn.addEventListener("click", () => {
    ranges = [];
    drag = null;
    const title = document.getElementById("heat-title");
    if (title) title.value = "";
    const confirm = document.getElementById("heat-confirm");
    if (confirm) confirm.hidden = true;
    paintSelection();
  });
  if (confirmBtn) confirmBtn.addEventListener("click", createEvents);
  if (backBtn) backBtn.addEventListener("click", () => {
    document.getElementById("heat-confirm").hidden = true;
  });

  Promise.all([
    getJson("/api/heatmap-settings"),
    getJson("/api/people"),
    getJson("/api/groups"),
  ])
    .then((triple) => {
      applyHeatSettings(triple[0]);
      people = Array.isArray(triple[1].people) ? triple[1].people : [];
      groups = Array.isArray(triple[2].groups) ? triple[2].groups : [];
      const wanted = (heatSettings.defaultGroupName || "").trim().toLowerCase();
      const match = wanted
        ? groups.find((group) => (group.name || "").trim().toLowerCase() === wanted)
        : null;
      if (match) {
        groupIds[match.id] = true;
      } else if (wanted === "hosts") {
        people.forEach((person) => {
          if (person.role === "host") pickedIds[person.id] = true;
        });
      }
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
    const defaultInput = document.getElementById("heat-default-group");
    Promise.all([getJson("/api/heatmap-settings"), getJson("/api/groups")]).then((pair) => {
      const data = pair[0];
      const groupData = pair[1];
      if (dayInput && Number.isInteger(data.dayCount)) dayInput.value = String(data.dayCount);
      if (weekendInput) weekendInput.value = data.showWeekends ? "yes" : "no";
      if (startInput && Number.isInteger(data.windowStartMinutes)) {
        startInput.value = String(data.windowStartMinutes);
      }
      if (endInput && Number.isInteger(data.windowEndMinutes)) {
        endInput.value = String(data.windowEndMinutes);
      }
      if (defaultInput) {
        const current = typeof data.defaultGroupName === "string" ? data.defaultGroupName : "Hosts";
        const names = [];
        (groupData.groups || []).forEach((group) => {
          const name = group.name || "";
          if (name && names.indexOf(name) === -1) names.push(name);
        });
        if (current && names.indexOf(current) === -1) names.unshift(current);
        while (defaultInput.options.length) defaultInput.remove(0);
        defaultInput.append(h("option", { value: "", text: "No one" }));
        names.forEach((name) => {
          const opt = h("option", { value: name, text: name });
          if (name === current) opt.selected = true;
          defaultInput.append(opt);
        });
        defaultInput.value = current;
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
        defaultGroupName: defaultInput ? defaultInput.value : "Hosts",
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

function initShareWindow() {
  const form = document.getElementById("share-window-form");
  if (!form) return;
  const msg = document.getElementById("share-window-msg");
  loadMe(false).then((me) => {
    const chosen = me.shareWindow || "full";
    const input = form.querySelector('input[name="share-window"][value="' + chosen + '"]');
    if (input) input.checked = true;
  }).catch(() => {
    setBanner(msg, "bad", "Could not load your sharing window.");
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const selected = form.querySelector('input[name="share-window"]:checked');
    const windowName = selected ? selected.value : "full";
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    send("POST", "/api/me/share-window", { window: windowName }).then(() => {
      setBanner(msg, "ok", "Saved. Other people only see free or busy time inside this window.");
    }).catch((err) => {
      setBanner(msg, "bad", (err && err.message) || "Could not save sharing");
    }).then(() => {
      button.disabled = false;
    });
  });
}

function initNav() {
  const toggle = document.getElementById("nav-toggle");
  const scrim = document.getElementById("nav-scrim");
  const nav = document.getElementById("app-nav");
  if (!toggle || !nav) return;
  function setOpen(open) {
    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (scrim) scrim.hidden = !open;
  }
  toggle.addEventListener("click", () => {
    setOpen(!document.body.classList.contains("nav-open"));
  });
  if (scrim) scrim.addEventListener("click", () => setOpen(false));
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const pop = document.getElementById("heat-range-popover");
    if (pop && !pop.hidden) return;
    setOpen(false);
  });
}

initNav();
if (page === "home" || page === "calendars" || page === "delete") initHome();
if (page === "home") initHeat();
if (page === "calendars") initCalendars();
if (page === "calendars") initShareWindow();
if (page === "admin") initAdmin();
})();`;
}
