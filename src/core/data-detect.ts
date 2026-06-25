import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Auto-detect the standard data shape for `premo adopt` (DATA-DIRECTORIES.md §3.2):
// an app that relocates ALL its mutable state via a single env var defaulting to a
// `.data`-ish dir. The three reference repos converge on this — finances
// (`FINANCES_DATA_DIR` → a postgres bind-mount), orchestrator (`DATA_DIR`), chess
// (`DATABASE_URL=file:.data/chess.db`). We only fire on declarative, high-confidence
// signals (compose volumes, env files); anything more exotic stays a one-line manual
// `data` block. Returns the directory-adapter config, or undefined.

export interface DetectedData {
  dir: string;
  env: Record<string, string>;
}

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
const ENV_FILES = [
  ".env",
  ".env.example",
  ".env.sample",
  "backend/.env",
  "backend/.env.example",
  "backend/.env.sample",
];

// A bounded set of conventional config sources to scan for a `process.env.*DATA_DIR`
// reference — the orchestrator shape, where the relocating var lives in code, not a
// declarative file. Kept to well-known config locations so this stays a cheap,
// low-false-positive read rather than a tree-wide scrape.
const CONFIG_FILES = [
  "config.ts",
  "config.js",
  "src/config.ts",
  "src/config.js",
  "src/env.ts",
  "backend/src/config.ts",
  "backend/src/config.js",
  "backend/src/env.ts",
];

// Normalize a path value into a root-relative dir: drop quotes, a leading `./`, and
// any trailing slash. `./.data` → `.data`, `"./data/"` → `data`.
function cleanDir(v?: string | null): string | undefined {
  if (!v) return undefined;
  const s = v
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return s || undefined;
}

function read(root: string, rel: string): string | undefined {
  const p = path.join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}

export function detectData(root: string): DetectedData | undefined {
  // 1. A docker-compose volume relocated by a *_DATA_DIR var: ${FOO_DATA_DIR:-./.data}
  for (const f of COMPOSE_FILES) {
    const text = read(root, f);
    if (!text) continue;
    const m = text.match(/\$\{((?:[A-Z][A-Z0-9_]*_)?DATA_DIR)(?::-([^}]+))?\}/);
    if (m) return { dir: cleanDir(m[2]) ?? ".data", env: { [m[1]!]: "${PREMO_DATA_DIR}" } };
  }
  // 2. An env file declaring a *_DATA_DIR var, or a sqlite `file:` url.
  for (const f of ENV_FILES) {
    const text = read(root, f);
    if (!text) continue;
    const dd = text.match(/^\s*((?:[A-Z][A-Z0-9_]*_)?DATA_DIR)\s*=\s*(.+?)\s*$/m);
    if (dd) return { dir: cleanDir(dd[2]) ?? ".data", env: { [dd[1]!]: "${PREMO_DATA_DIR}" } };
    const sqlite = text.match(/^\s*DATABASE_URL\s*=\s*["']?file:([^"'\s]+)/m);
    if (sqlite) {
      const base = path.posix.basename(sqlite[1]!.replace(/\\/g, "/"));
      return { dir: ".data", env: { DATABASE_URL: "file:${PREMO_DATA_DIR}/" + base } };
    }
  }
  // 3. A `process.env.*DATA_DIR` reference in a conventional config source.
  for (const f of CONFIG_FILES) {
    const text = read(root, f);
    if (!text) continue;
    const m = text.match(/process\.env\.((?:[A-Z][A-Z0-9_]*_)?DATA_DIR)\b/);
    if (m) return { dir: ".data", env: { [m[1]!]: "${PREMO_DATA_DIR}" } };
  }
  return undefined;
}
