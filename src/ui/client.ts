import { TIME_FNS } from "./time";

/**
 * Page script for the signed-in screens. Talks to existing JSON APIs.
 * Renders with textContent. Stores calendar ids and names only.
 */
export function clientScript(): string {
  return `(() => {
"use strict";
${TIME_FNS}
const page = document.body.getAttribute("data-page") || "";
const tz = document.body.getAttribute("data-tz") || "America/Chicago";
const selfEmail = (document.body.getAttribute("data-email") || "").toLowerCase();
let meCache = null;
let filterQuery = "";

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

function mark(node, text) {
  node.setAttribute("data-filter", text);
  node.hidden = filterQuery.length > 0 && text.toLowerCase().indexOf(filterQuery) === -1;
}

function applyFilter() {
  const nodes = document.querySelectorAll("main [data-filter]");
  let total = 0;
  let shown = 0;
  nodes.forEach((node) => {
    total += 1;
    const hay = (node.getAttribute("data-filter") || "").toLowerCase();
    const hide = filterQuery.length > 0 && hay.indexOf(filterQuery) === -1;
    node.hidden = hide;
    if (!hide) shown += 1;
  });
  const empty = document.getElementById("filter-empty");
  if (empty) empty.hidden = !(filterQuery && total > 0 && shown === 0);
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

function initSearch() {
  const input = document.getElementById("nav-search");
  if (!input) return;
  input.addEventListener("input", () => {
    filterQuery = input.value.trim().toLowerCase();
    applyFilter();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
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
    mark(label, summary + " " + id);
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
  applyFilter();
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
      mark(label, [display, person.email || "", person.role || ""].join(" "));
      peopleEl.append(label);
    });
    applyFilter();
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
      mark(row, day + " " + time + " " + endTime);
      if (group) group.append(row);
    });
    applyFilter();
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
      mark(row, (user.email || "") + " " + (user.role || ""));
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
      mark(card, (group.name || "") + " " + ids.join(" "));
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
      mark(row, String(email) + " " + title);
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
      applyFilter();
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

initSearch();
if (page === "home" || page === "delete") initHome();
if (page === "calendars") initCalendars();
if (page === "times") initTimes();
if (page === "admin") initAdmin();
})();`;
}
