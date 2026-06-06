// Generic shell-string helpers, independent of any one adapter or command.

// Shell-quote a value for safe interpolation into a command string.
export function shq(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
