import { tailscaleProvider } from "./tailscale.js";

// A ShareProvider owns one tunnel backend for `premo share` (DESIGN §14.2). Same
// registered-strategy shape as core/runners: premo looks the provider up by name,
// asks if it's usable, gets the FOREGROUND command to run for a port, and asks
// for the public URL to surface. The command is a shell string premo supervises
// itself (foreground, or detached via `--background`) — premo never delegates to
// the backend's own `--bg`, so `premo stop`/`logs` stay authoritative. tailscale
// is first; ngrok/cloudflared register by adding to PROVIDERS.
export interface ShareProvider {
  name: string;
  // Is the backend installed, authed, and otherwise ready? `reason` (when not ok)
  // drives the "helpful not-implemented" message instead of a raw CLI error.
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  // The foreground command that opens a public tunnel to localhost:<port>.
  command(port: number): string;
  // The public URL to show the user (best-effort; null when it can't be derived
  // without watching the command's own output).
  publicUrl(port: number): Promise<string | null>;
}

const PROVIDERS: ShareProvider[] = [tailscaleProvider];

export function getProvider(name: string): ShareProvider | null {
  return PROVIDERS.find((p) => p.name === name) ?? null;
}

export function providerNames(): string[] {
  return PROVIDERS.map((p) => p.name);
}
