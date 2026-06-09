import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TOKEN_RE = /\$\{([A-Z][A-Z0-9_]*)\}/g;

// Parse a dotenv-style file (KEY=VALUE per line; #-comments and blanks ignored;
// surrounding quotes stripped) into a record. Missing file ⇒ {}. Best-effort: a
// premo convenience so host dev/build/test processes see the same config the
// repo's `.env` provides (docker compose already auto-loads it). See `envFile`.
export async function loadEnvFile(
  root: string,
  file: string | undefined,
): Promise<Record<string, string>> {
  if (!file) return {};
  const p = path.join(root, file);
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of (await readFile(p, "utf8")).split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]!] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

// The env-file values not already set in the real environment — they fill gaps
// without overriding an explicitly-exported variable (dotenv/compose precedence:
// the real shell env, and premo's own injected vars, always win).
export function gapFill(fileVars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fileVars)) if (!(k in process.env)) out[k] = v;
  return out;
}

// Convenience: the gap-fill env vars from a project's configured `envFile`.
export async function envFileVars(
  root: string,
  envFile: string | undefined,
): Promise<Record<string, string>> {
  return gapFill(await loadEnvFile(root, envFile));
}

export function interpolateEnv(input: string, env: Record<string, string | number>): string {
  return input.replace(TOKEN_RE, (_match, key: string) => {
    if (!(key in env)) {
      throw new Error(
        `No value for \${${key}} (available: ${Object.keys(env).join(", ") || "none"})`,
      );
    }
    return String(env[key]);
  });
}

export function interpolateArgv(argv: string[], env: Record<string, string | number>): string[] {
  return argv.map((a) => interpolateEnv(a, env));
}
