import type { Env, Role } from "../types";
import {
  inviteUser,
  listUsers,
  normalizeEmail,
  removeUser,
  setRole,
  writeAudit,
} from "../db/users";
import { syncAccessFromDb, isAccessSyncConfigured } from "../access/sync";
import {
  diffGoogleTestUsers,
  GOOGLE_TEST_USERS_DOC,
} from "../access/google-test-users";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroupMemberIds,
  listGroups,
  removeGroupMember,
  renameGroup,
} from "../db/groups";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  requireCsrf,
  requireUser,
} from "../middleware/session";
import {
  getHeatmapSettings,
  normalizeHeatmapSettings,
  saveHeatmapSettings,
} from "../db/heatmap-settings";

const ROLES: Role[] = ["host", "producer", "guest", "admin"];

async function afterRosterChange(env: Env): Promise<unknown> {
  return syncAccessFromDb(env);
}

export async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/admin") && !path.startsWith("/api/groups")) {
    return null;
  }

  const authed = await requireUser(request, env);
  if (authed instanceof Response) return authed;

  // Groups: list for any signed-in user; mutations admin-only below
  if (path === "/api/groups" && request.method === "GET") {
    const groups = await listGroups(env.DB);
    const out = [];
    for (const g of groups) {
      const memberIds = await listGroupMemberIds(env.DB, g.id);
      out.push({ ...g, memberIds });
    }
    return jsonOk({ groups: out });
  }

  if (path.startsWith("/api/groups")) {
    const adminErr = requireAdmin(authed.user);
    if (adminErr) return adminErr;
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;

    if (path === "/api/groups" && request.method === "POST") {
      const body = (await request.json()) as { name?: string };
      if (!body.name?.trim()) return jsonError(400, "name required");
      try {
        const group = await createGroup(env.DB, body.name);
        await writeAudit(env, {
          actorUserId: authed.user.id,
          action: "group_create",
          meta: { groupId: group.id, name: group.name },
        });
        return jsonOk({ group });
      } catch {
        return jsonError(409, "group create failed");
      }
    }

    if (path === "/api/groups/rename" && request.method === "POST") {
      const body = (await request.json()) as { groupId?: string; name?: string };
      if (!body.groupId || !body.name?.trim()) {
        return jsonError(400, "groupId and name required");
      }
      if (!(await getGroup(env.DB, body.groupId))) {
        return jsonError(404, "group not found");
      }
      await renameGroup(env.DB, body.groupId, body.name);
      await writeAudit(env, {
        actorUserId: authed.user.id,
        action: "group_rename",
        meta: { groupId: body.groupId, name: body.name.trim() },
      });
      return jsonOk({ ok: true });
    }

    if (path === "/api/groups/delete" && request.method === "POST") {
      const body = (await request.json()) as { groupId?: string };
      if (!body.groupId) return jsonError(400, "groupId required");
      await deleteGroup(env.DB, body.groupId);
      await writeAudit(env, {
        actorUserId: authed.user.id,
        action: "group_delete",
        meta: { groupId: body.groupId },
      });
      return jsonOk({ ok: true });
    }

    if (path === "/api/groups/members/add" && request.method === "POST") {
      const body = (await request.json()) as {
        groupId?: string;
        userId?: string;
      };
      if (!body.groupId || !body.userId) {
        return jsonError(400, "groupId and userId required");
      }
      await addGroupMember(env.DB, body.groupId, body.userId);
      return jsonOk({ ok: true });
    }

    if (path === "/api/groups/members/remove" && request.method === "POST") {
      const body = (await request.json()) as {
        groupId?: string;
        userId?: string;
      };
      if (!body.groupId || !body.userId) {
        return jsonError(400, "groupId and userId required");
      }
      await removeGroupMember(env.DB, body.groupId, body.userId);
      return jsonOk({ ok: true });
    }

    return jsonError(404, "not found");
  }

  // Admin APIs
  if (!path.startsWith("/api/admin")) return null;

  const adminErr = requireAdmin(authed.user);
  if (adminErr) return adminErr;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const csrfErr = requireCsrf(request, authed.csrfSecret);
    if (csrfErr) return csrfErr;
  }

  if (path === "/api/admin/heatmap-settings" && request.method === "GET") {
    return jsonOk(await getHeatmapSettings(env.DB));
  }

  if (path === "/api/admin/heatmap-settings" && request.method === "POST") {
    const body = (await request.json()) as {
      dayCount?: unknown;
      showWeekends?: unknown;
      windowStartMinutes?: unknown;
      windowEndMinutes?: unknown;
    };
    const parsed = normalizeHeatmapSettings(body);
    if (!parsed.ok) return jsonError(400, parsed.error);
    try {
      await saveHeatmapSettings(env.DB, parsed.settings, authed.user.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("no such table")) {
        return jsonError(
          503,
          "heatmap settings are not available until the database migration is applied",
        );
      }
      throw err;
    }
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "heatmap_settings",
      meta: { ...parsed.settings },
    });
    return jsonOk(parsed.settings);
  }

  if (path === "/api/admin/users" && request.method === "GET") {
    const users = await listUsers(env.DB);
    return jsonOk({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        token_status: u.token_status,
        calendar_connected_at: u.calendar_connected_at,
        last_login_at: u.last_login_at,
      })),
    });
  }

  if (path === "/api/admin/invite" && request.method === "POST") {
    const body = (await request.json()) as { email?: string; role?: Role };
    if (!body.email || !body.role || !ROLES.includes(body.role)) {
      return jsonError(400, "email and role required");
    }
    const email = normalizeEmail(body.email);
    try {
      const user = await inviteUser(env.DB, email, body.role, authed.user.id);
      await writeAudit(env, {
        actorUserId: authed.user.id,
        action: "invite",
        targetEmail: email,
        meta: { role: body.role },
      });
      const accessSync = await afterRosterChange(env);
      return jsonOk({
        user: { id: user.id, email: user.email, role: user.role },
        accessSync,
        googleTestUsersHint:
          "Add this email to Google OAuth test users; see GET /api/admin/google-test-users",
      });
    } catch {
      return jsonError(409, "invite failed (maybe already invited)");
    }
  }

  if (path === "/api/admin/remove" && request.method === "POST") {
    const body = (await request.json()) as { userId?: string; email?: string };
    if (!body.userId) return jsonError(400, "userId required");
    if (body.userId === authed.user.id) {
      return jsonError(400, "cannot remove yourself");
    }
    await removeUser(env.DB, body.userId);
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "remove",
      targetEmail: body.email ?? null,
      meta: { userId: body.userId },
    });
    const accessSync = await afterRosterChange(env);
    return jsonOk({ ok: true, accessSync });
  }

  if (path === "/api/admin/role" && request.method === "POST") {
    const body = (await request.json()) as { userId?: string; role?: Role };
    if (!body.userId || !body.role || !ROLES.includes(body.role)) {
      return jsonError(400, "userId and role required");
    }
    await setRole(env.DB, body.userId, body.role);
    await writeAudit(env, {
      actorUserId: authed.user.id,
      action: "role_change",
      meta: { userId: body.userId, role: body.role },
    });
    return jsonOk({ ok: true });
  }

  if (path === "/api/admin/access-sync" && request.method === "POST") {
    const result = await syncAccessFromDb(env);
    return jsonOk({
      configured: isAccessSyncConfigured(env),
      result,
    });
  }

  if (path === "/api/admin/access-sync" && request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT * FROM access_sync_state WHERE id = 1",
    ).first<{
      last_attempt_at: string | null;
      last_success_at: string | null;
      last_status: string;
      last_error: string | null;
      last_emails_json: string | null;
    }>();
    return jsonOk({
      configured: isAccessSyncConfigured(env),
      state: row,
    });
  }

  if (path === "/api/admin/google-test-users" && request.method === "GET") {
    const users = await listUsers(env.DB);
    const acks = await env.DB.prepare(
      "SELECT email_normalized FROM google_test_user_acks",
    ).all<{ email_normalized: string }>();
    const diff = diffGoogleTestUsers(
      users.map((u) => u.email),
      (acks.results ?? []).map((a) => a.email_normalized),
    );
    return jsonOk({
      ...diff,
      docs: GOOGLE_TEST_USERS_DOC,
      instructions:
        "Add toAdd in Google Cloud → OAuth consent → Test users, then POST /api/admin/google-test-users/ack. Remove toRemove in console, then POST .../unack.",
    });
  }

  if (path === "/api/admin/google-test-users/ack" && request.method === "POST") {
    const body = (await request.json()) as { email?: string };
    if (!body.email) return jsonError(400, "email required");
    const email = normalizeEmail(body.email);
    await env.DB.prepare(
      `INSERT INTO google_test_user_acks (email_normalized, acked_at, acked_by_user_id)
       VALUES (?, ?, ?)
       ON CONFLICT(email_normalized) DO UPDATE SET
         acked_at = excluded.acked_at,
         acked_by_user_id = excluded.acked_by_user_id`,
    )
      .bind(email, new Date().toISOString(), authed.user.id)
      .run();
    return jsonOk({ ok: true, email });
  }

  if (
    path === "/api/admin/google-test-users/unack" &&
    request.method === "POST"
  ) {
    const body = (await request.json()) as { email?: string };
    if (!body.email) return jsonError(400, "email required");
    await env.DB.prepare(
      "DELETE FROM google_test_user_acks WHERE email_normalized = ?",
    )
      .bind(normalizeEmail(body.email))
      .run();
    return jsonOk({ ok: true });
  }

  return jsonError(404, "not found");
}
