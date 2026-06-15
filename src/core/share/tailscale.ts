import { execa } from "execa";
import type { ShareProvider } from "./index.js";

// Public access ⇒ `tailscale funnel` (not `tailscale serve`, which is
// tailnet-private). premo runs the FOREGROUND form — `tailscale funnel <port>`,
// never `--bg` — so premo's own supervision owns the lifecycle (DESIGN §14.3).
export const tailscaleProvider: ShareProvider = {
  name: "tailscale",

  async isAvailable() {
    const res = await execa("tailscale", ["status"], { reject: false });
    if (res.exitCode === 0) return { ok: true };
    // execa surfaces a spawn failure (binary missing) as `code: "ENOENT"`.
    if ((res as { code?: string }).code === "ENOENT") {
      return { ok: false, reason: "tailscale CLI not found — install Tailscale." };
    }
    // Reachable but unusable: almost always logged-out / daemon down.
    return {
      ok: false,
      reason:
        "tailscale isn't ready (run `tailscale up`, and enable Funnel in your tailnet policy).",
    };
  },

  command(port) {
    return `tailscale funnel ${port}`;
  },

  // Funnel terminates TLS and serves on https://<node>.<tailnet>.ts.net (the
  // default public port is 443, so it's absent from the URL). The local <port>
  // doesn't appear in the public URL, so it isn't needed here.
  async publicUrl() {
    const res = await execa("tailscale", ["status", "--json"], { reject: false });
    if (res.exitCode !== 0) return null;
    try {
      const dns = (JSON.parse(res.stdout) as { Self?: { DNSName?: string } }).Self?.DNSName;
      if (!dns) return null;
      return `https://${dns.replace(/\.$/, "")}`;
    } catch {
      return null;
    }
  },
};
