/**
 * Nightly D1 export helper.
 * Default --dry-run: prints the wrangler command that WOULD run.
 * Never prints secrets. Does not create R2 buckets or remote D1.
 *
 * Backup security notes:
 * - Ephemeral `sessions` rows (already hashed in D1) are stripped from exported
 *   SQL so backups never carry session records.
 * - `oauth_tokens` rows contain AES-256-GCM ciphertext bound with per-user AAD;
 *   without `TOKEN_ENCRYPTION_KEY` they cannot be decrypted, and on key loss
 *   users simply reconnect Google Calendar.
 * - Exported SQL still contains PII (`users`, `audit_log`, `calendars_selected`).
 *   Always encrypt backups (e.g., age/KMS) before uploading to a private R2
 *   bucket, and NEVER commit files under `backups/` to git.
 *
 * Usage:
 *   npx tsx scripts/backup-d1.ts --dry-run
 *   BACKUP_ENV=staging npx tsx scripts/backup-d1.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Strip ephemeral `sessions` INSERT statements from a D1 SQL export.
 * Schema DDL (`CREATE TABLE sessions ...`) is preserved for clean restores.
 */
export function scrubSessionsFromSql(sql: string): string {
  return sql
    .split("\n")
    .filter(
      (line) =>
        !/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?sessions["'`]?\b/i.test(line),
    )
    .join("\n");
}

function main(): void {
  const dry =
    process.argv.includes("--dry-run") || !process.env.CLOUDFLARE_API_TOKEN;
  const envName = process.env.BACKUP_ENV ?? "staging";
  const dbName =
    envName === "production"
      ? "operators-scheduler-prod"
      : envName === "staging"
        ? "operators-scheduler-staging"
        : "operators-scheduler-local";

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outDir = `backups/${envName}`;
  const outFile = `${outDir}/${dbName}-${stamp}.sql`;

  const args = [
    "wrangler",
    "d1",
    "export",
    dbName,
    "--remote",
    `--output=${outFile}`,
  ];

  console.log(`[backup] env=${envName} db=${dbName}`);
  console.log(`[backup] would run: npx ${args.join(" ")}`);

  if (dry) {
    console.log("[backup] dry-run only (no token or --dry-run). Exiting 0.");
    process.exit(0);
  }

  mkdirSync(outDir, { recursive: true });
  const res = spawnSync("npx", args, { stdio: "inherit", env: process.env });
  if (res.status !== 0) {
    console.error("[backup] wrangler export failed");
    process.exit(res.status ?? 1);
  }

  // Strip ephemeral sessions rows from the SQL dump before retention/upload.
  const rawSql = readFileSync(outFile, "utf8");
  writeFileSync(outFile, scrubSessionsFromSql(rawSql));

  // Retention note: encrypt before upload and keep 30 days in private R2 storage.
  writeFileSync(
    `${outDir}/LATEST.txt`,
    `${outFile}\nNote: sessions stripped; oauth_tokens are AES-256-GCM ciphertext only (reconnect if key lost). Encrypt before off-box upload because users/audit_log contain PII.\n`,
  );
  console.log(`[backup] wrote ${outFile} (sessions scrubbed)`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
