export type Role = "host" | "producer" | "guest" | "admin";
export type TokenStatus = "none" | "ok" | "expired" | "revoked";

export interface Env {
  DB: D1Database;
  APP_NAME: string;
  DEFAULT_TIMEZONE: string;
  ENVIRONMENT: string;
  ALLOW_PRODUCTION: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  APP_BASE_URL: string;
}

export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  name: string | null;
  role: Role;
  google_sub: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  calendar_connected_at: string | null;
  token_status: TokenStatus;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface FreeSlot {
  start: Date;
  end: Date;
  startCt: string;
  endCt: string;
}

export interface FindSlotsInput {
  busyByUser: BusyInterval[][];
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  /** Minutes from midnight CT for daily window start, inclusive */
  windowStartMinutes: number;
  /** Minutes from midnight CT for daily window end, exclusive */
  windowEndMinutes: number;
  stepMinutes?: number;
  maxSlots?: number;
  timeZone?: string;
}
