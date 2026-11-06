#!/usr/bin/env node
/**
 * Lightweight secret scan for CI. Fails on high-confidence patterns in tracked files.
 * Not a replacement for GitHub secret scanning / gitleaks once repo exists.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  { name: "Google client secret style", re: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "CF API token prefix", re: /\b(CFAuth|cloudflare).*['\"][A-Za-z0-9_-]{40,}['\"]/gi },
  { name: "GitHub PAT", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
];

let files;
try {
  files = execSync("git ls-files", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
} catch {
  // not a git repo yet — scan common paths
  files = execSync("find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.wrangler/*'", {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

const skip = new Set([
  "scripts/secret-scan.mjs",
  ".dev.vars.example",
  "docs/access-app.staging.example.json",
]);

let failed = false;
for (const f of files) {
  if (skip.has(f)) continue;
  if (f.includes("node_modules") || f.endsWith(".png") || f.endsWith(".lock")) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const p of patterns) {
    if (p.re.test(text)) {
      console.error(`SECRET_SCAN_HIT ${p.name} in ${f}`);
      failed = true;
    }
    p.re.lastIndex = 0;
  }
}

if (failed) {
  console.error("secret-scan failed");
  process.exit(1);
}
console.log(`secret-scan ok (${files.length} files)`);
