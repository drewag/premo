const TOKEN_RE = /\$\{([A-Z][A-Z0-9_]*)\}/g;

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
