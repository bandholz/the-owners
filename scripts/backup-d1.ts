/**
 * Nightly D1 export helper.
 * Default --dry-run: prints the wrangler command that WOULD run.
 * Never prints secrets. Does not create R2 buckets or remote D1.
 *
 * Usage:
 *   npx tsx scripts/backup-d1.ts --dry-run
 *   BACKUP_ENV=staging npx tsx scripts/backup-d1.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dry = process.argv.includes("--dry-run") || !process.env.CLOUDFLARE_API_TOKEN;
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
// Retention note: keep 30 days in object storage once R2 is approved.
writeFileSync(
  `${outDir}/LATEST.txt`,
  `${outFile}\nNote: ciphertext tokens only; reconnect if key lost.\n`,
);
console.log(`[backup] wrote ${outFile}`);
