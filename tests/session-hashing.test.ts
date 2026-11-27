import { describe, expect, it } from "vitest";
import {
  createSession,
  deleteSessionByRawToken,
  getSession,
  hashSessionToken,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_ROTATE_AFTER_MS,
  SESSION_ROTATION_GRACE_MS,
  type SessionRow,
} from "../src/db/sessions";
import {
  clearAllSessionCookies,
  getSessionTokenFromCookies,
  HOST_SESSION_COOKIE,
  parseCookies,
  sessionCookieHeader,
} from "../src/middleware/session";
import { loadRefreshToken, storeRefreshToken } from "../src/db/tokens";
import { scrubSessionsFromSql } from "../scripts/backup-d1";

const SECRET = "test-session-hmac-secret-32-chars";
const KEY1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

function makeSessionDb() {
  const rows = new Map<string, SessionRow>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...b: unknown[]) {
          args = b;
          return stmt;
        },
        async run() {
          if (sql.includes("INSERT INTO sessions")) {
            rows.set(String(args[0]), {
              id: String(args[0]),
              user_id: String(args[1]),
              csrf_secret: String(args[2]),
              created_at: String(args[3]),
              expires_at: String(args[4]),
              max_expires_at: args[5] ? String(args[5]) : null,
            });
          } else if (sql.includes("UPDATE sessions SET expires_at")) {
            const row = rows.get(String(args[1]));
            if (row) row.expires_at = String(args[0]);
          } else if (sql.includes("DELETE FROM sessions WHERE id")) {
            rows.delete(String(args[0]));
          } else if (sql.includes("DELETE FROM sessions WHERE user_id")) {
            for (const [k, v] of rows.entries()) {
              if (v.user_id === String(args[0])) rows.delete(k);
            }
          }
          return { success: true };
        },
        async first<T>() {
          if (sql.includes("SELECT * FROM sessions WHERE id")) {
            return (rows.get(String(args[0])) ?? null) as T | null;
          }
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, rows };
}

describe("hashed sessions, expiry, rotation, and logout invalidation", () => {
  it("stores hashed session id and salt in D1, rejecting stored hash as cookie", async () => {
    const { db, rows } = makeSessionDb();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    const issued = await createSession(db, "user-1", SECRET, { now: t0 });

    expect(issued.rawToken.length).toBeGreaterThanOrEqual(40);
    expect(issued.id).not.toBe(issued.rawToken);
    expect(issued.id).toBe(await hashSessionToken(issued.rawToken, SECRET));

    const stored = rows.get(issued.id)!;
    expect(stored).toBeDefined();
    expect(stored.csrf_secret).not.toBe(issued.csrfToken);

    // Raw token verifies
    const ok = await getSession(db, issued.rawToken, SECRET, t0);
    expect(ok).not.toBeNull();
    expect(ok!.csrfToken).toBe(issued.csrfToken);

    // Presenting the raw DB hash directly fails
    const replayHash = await getSession(db, issued.id, SECRET, t0);
    expect(replayHash).toBeNull();
  });

  it("enforces idle expiry and absolute 7-day cap", async () => {
    const { db, rows } = makeSessionDb();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    const issued = await createSession(db, "user-1", SECRET, { now: t0 });

    // Expired after idle window
    const afterIdle = new Date(t0.getTime() + SESSION_IDLE_TTL_MS + 1000);
    expect(await getSession(db, issued.rawToken, SECRET, afterIdle)).toBeNull();
    expect(rows.size).toBe(0);

    // Fresh session rotated repeatedly still expires at 7-day absolute cap
    let current = await createSession(db, "user-1", SECRET, { now: t0 });
    const nearCap = new Date(t0.getTime() + SESSION_ABSOLUTE_TTL_MS + 1000);
    expect(await getSession(db, current.rawToken, SECRET, nearCap)).toBeNull();
  });

  it("rotates session after 12h with a 60s grace window on the old token", async () => {
    const { db } = makeSessionDb();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    const issued = await createSession(db, "user-1", SECRET, { now: t0 });

    const tRotate = new Date(t0.getTime() + SESSION_ROTATE_AFTER_MS + 1000);
    const first = await getSession(db, issued.rawToken, SECRET, tRotate);
    expect(first).not.toBeNull();
    expect(first!.rotated).toBeDefined();
    expect(first!.rotated!.rawToken).not.toBe(issued.rawToken);
    expect(first!.rotated!.max_expires_at).toBe(issued.max_expires_at);

    // Old token still works during 60s grace window for in-flight parallel fetches
    const inGrace = new Date(tRotate.getTime() + 10_000);
    const duringGrace = await getSession(db, issued.rawToken, SECRET, inGrace);
    expect(duringGrace).not.toBeNull();
    expect(duringGrace!.rotated).toBeUndefined();

    // Old token expires immediately after grace window
    const afterGrace = new Date(tRotate.getTime() + SESSION_ROTATION_GRACE_MS + 1000);
    expect(await getSession(db, issued.rawToken, SECRET, afterGrace)).toBeNull();

    // New rotated token remains valid
    const newOk = await getSession(db, first!.rotated!.rawToken, SECRET, afterGrace);
    expect(newOk).not.toBeNull();
  });

  it("invalidates session on logout via raw token hash", async () => {
    const { db } = makeSessionDb();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    const issued = await createSession(db, "user-1", SECRET, { now: t0 });

    await deleteSessionByRawToken(db, issued.rawToken, SECRET);
    expect(await getSession(db, issued.rawToken, SECRET, t0)).toBeNull();
  });
});

describe("safe cookie parsing and __Host- prefix", () => {
  it("survives malformed percent-encoding, uses null prototype, and keeps first value", () => {
    const parsed = parseCookies(
      "__Host-ots_session=good; __Host-ots_session=shadowed; bad=%E0%A4%A; __proto__=polluted",
    );
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed[HOST_SESSION_COOKIE]).toBe("good");
    expect(parsed.bad).toBe("%E0%A4%A");
  });

  it("uses __Host-ots_session on secure origins and ignores legacy ots_session", () => {
    const header = sessionCookieHeader("raw-tok", "2099-01-01T00:00:00.000Z", true);
    expect(header).toContain("__Host-ots_session=raw-tok");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(header).not.toContain("Domain=");

    const cookies = parseCookies("ots_session=legacy-from-subdomain");
    expect(getSessionTokenFromCookies(cookies, true)).toBeUndefined();
    expect(getSessionTokenFromCookies(cookies, false)).toBe("legacy-from-subdomain");

    const cleared = clearAllSessionCookies(true);
    expect(cleared).toHaveLength(2);
    expect(cleared[0]).toContain("__Host-ots_session=");
    expect(cleared[1]).toContain("ots_session=");
  });
});

describe("OAuth refresh token AAD binding and key rotation", () => {
  it("prevents transplanting encrypted token across user_ids and supports rotation", async () => {
    const tokens = new Map<
      string,
      {
        refresh_token_ciphertext: Uint8Array;
        refresh_token_iv: Uint8Array;
        refresh_token_tag: Uint8Array;
        scopes: string;
        key_version: number;
        aad_bound: number;
      }
    >();
    const db = {
      prepare(sql: string) {
        let args: unknown[] = [];
        const stmt = {
          bind(...b: unknown[]) {
            args = b;
            return stmt;
          },
          async run() {
            if (sql.includes("INSERT INTO oauth_tokens")) {
              tokens.set(String(args[0]), {
                refresh_token_ciphertext: args[1] as Uint8Array,
                refresh_token_iv: args[2] as Uint8Array,
                refresh_token_tag: args[3] as Uint8Array,
                scopes: String(args[4]),
                key_version: Number(args[6] ?? 1),
                aad_bound: 1,
              });
            } else if (sql.includes("UPDATE oauth_tokens")) {
              const existing = tokens.get(String(args[5]));
              if (existing) {
                existing.refresh_token_ciphertext = args[0] as Uint8Array;
                existing.refresh_token_iv = args[1] as Uint8Array;
                existing.refresh_token_tag = args[2] as Uint8Array;
                existing.key_version = Number(args[3]);
                existing.aad_bound = 1;
              }
            }
            return { success: true };
          },
          async first() {
            if (sql.includes("FROM oauth_tokens")) {
              return tokens.get(String(args[0])) ?? null;
            }
            return null;
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    await storeRefreshToken(db, "user-a", "refresh-secret-a", ["scope1"], KEY1);
    expect(await loadRefreshToken(db, "user-a", KEY1)).toBe("refresh-secret-a");

    // Transplant user-a's encrypted blob onto user-b: AAD must reject it!
    tokens.set("user-b", { ...tokens.get("user-a")! });
    await expect(loadRefreshToken(db, "user-b", KEY1)).rejects.toThrow();

    // Key rotation: load with new KEY2 + previous KEY1 decrypts and lazily re-encrypts
    expect(await loadRefreshToken(db, "user-a", KEY2, KEY1)).toBe("refresh-secret-a");
    // Now decrypts directly with KEY2 alone
    expect(await loadRefreshToken(db, "user-a", KEY2)).toBe("refresh-secret-a");
  });
});

describe("backup SQL scrubber", () => {
  it("strips session INSERT statements while preserving schema and other tables", () => {
    const sample = [
      "CREATE TABLE sessions (id TEXT PRIMARY KEY);",
      `INSERT INTO "sessions" VALUES('hash1','u1','salt1','2026','2026');`,
      `INSERT OR REPLACE INTO sessions VALUES('hash2','u2','salt2','2026','2026');`,
      `INSERT INTO "users" VALUES('u1','host@example.com');`,
    ].join("\n");
    const scrubbed = scrubSessionsFromSql(sample);
    expect(scrubbed).toContain("CREATE TABLE sessions");
    expect(scrubbed).toContain(`INSERT INTO "users"`);
    expect(scrubbed).not.toContain("hash1");
    expect(scrubbed).not.toContain("hash2");
  });
});
