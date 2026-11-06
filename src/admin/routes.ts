import type { Env, Role } from "../types";
import {
  inviteUser,
  listUsers,
  normalizeEmail,
  removeUser,
  setRole,
  writeAudit,
} from "../db/users";
import {
  jsonError,
  jsonOk,
  requireAdmin,
  requireCsrf,
  requireUser,
} from "../middleware/session";

const ROLES: Role[] = ["host", "producer", "guest", "admin"];

export async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/admin")) return null;

  const authed = await requireUser(request, env);
  if (authed instanceof Response) return authed;
  const adminErr = requireAdmin(authed.user);
  if (adminErr) return adminErr;
  const csrfErr = requireCsrf(request, authed.csrfSecret);
  if (csrfErr) return csrfErr;

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
      return jsonOk({ user: { id: user.id, email: user.email, role: user.role } });
    } catch (e) {
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
    return jsonOk({ ok: true });
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

  return jsonError(404, "not found");
}
