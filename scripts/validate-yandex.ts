import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
const MAX_SIZE_MB = 100;
const FORBIDDEN_NAMES = /[а-яА-ЯёЁ\s]/;

interface Issue {
  level: "error" | "warn";
  msg: string;
}

const issues: Issue[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST} not found — run build first`);
  process.exit(1);
}

const files = walk(DIST);
const totalSize = files.reduce((s, f) => s + statSync(f).size, 0);
const totalMb = totalSize / 1024 / 1024;

if (totalMb > MAX_SIZE_MB) {
  issues.push({ level: "error", msg: `Build size ${totalMb.toFixed(1)}MB > ${MAX_SIZE_MB}MB` });
}

for (const f of files) {
  const rel = relative(DIST, f);
  if (FORBIDDEN_NAMES.test(rel)) {
    issues.push({ level: "error", msg: `Cyrillic/space in filename: ${rel}` });
  }
}

const indexPath = join(DIST, "index.html");
if (!existsSync(indexPath)) {
  issues.push({ level: "error", msg: "index.html missing in dist" });
} else {
  const html = readFileSync(indexPath, "utf8");
  if (!html.includes("yandex.ru/games/sdk/v2")) {
    issues.push({ level: "warn", msg: "Yandex SDK script tag not found in index.html" });
  }
  if (!/<title>.+<\/title>/.test(html)) {
    issues.push({ level: "warn", msg: "Empty <title> in index.html" });
  }
}

const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");

console.log(`Build size: ${totalMb.toFixed(2)} MB`);
for (const w of warns) console.warn(`⚠ ${w.msg}`);
for (const e of errors) console.error(`✗ ${e.msg}`);

if (errors.length > 0) process.exit(1);
console.log(`✓ Yandex validation passed (${warns.length} warnings)`);
