import { Command } from "commander";
import path from "node:path";
import { execa } from "execa";
import { ensureContext, type Context } from "../../core/context.js";
import { resolveTargets, defaultTarget, type Target } from "../../core/targets.js";
import { getProvider, providerNames } from "../../core/share/index.js";
import { spawnDetached } from "../../core/supervise.js";
import { log } from "../../core/logger.js";

export function register(program: Command): void {
  program
    .command("share")
    .description("Expose a running target's port on a public URL (via tailscale by default).")
    .argument("[target]", "share a single target (defaults to the serving target)")
    .option("--via <provider>", `tunnel backend: ${providerNames().join(", ")}`)
    .option("--background", "run detached; manage with `premo logs` / `premo stop`")
    .action(async (targetArg: string | undefined, opts: { via?: string; background?: boolean }) => {
      const ctx = await ensureContext(process.cwd());

      const targets = await resolveTargets(ctx.root, ctx.manifest);
      const pick = pickShareTarget(targets, targetArg);
      switch (pick.kind) {
        case "unknown":
          log.error(`No target "${targetArg}". Known: ${pick.known.join(", ") || "none"}`);
          process.exitCode = 1;
          return;
        case "none":
          log.warn("No serving target to share — `share` exposes one HTTP port.");
          log.dim(
            "  run `premo dev` once to allocate one, or set `ports` on a target in premo.json.",
          );
          process.exitCode = 1;
          return;
        case "ambiguous":
          log.error(`Multiple serving targets — pick one: ${pick.choices.join(", ")}`);
          process.exitCode = 1;
          return;
      }
      const target = pick.target;

      const port = target.ports?.base ?? ctx.manifest.ports?.base;
      if (port === undefined) {
        log.warn(`Target "${target.name}" has no port to share.`);
        log.dim("  it isn't a standalone HTTP server (a compose stack owns its own ports).");
        process.exitCode = 1;
        return;
      }

      const providerName = opts.via ?? ctx.manifest.share?.provider ?? "tailscale";
      const provider = getProvider(providerName);
      if (!provider) {
        log.error(`Unknown share provider "${providerName}". Known: ${providerNames().join(", ")}`);
        process.exitCode = 1;
        return;
      }

      const avail = await provider.isAvailable();
      if (!avail.ok) {
        log.error(`Can't share via ${provider.name}: ${avail.reason ?? "not available."}`);
        process.exitCode = 1;
        return;
      }

      // share is tunnel-only: it assumes the target is (or will be) serving on
      // the port. Remind, rather than starting `dev` ourselves (DESIGN §14.1).
      log.dim(`  sharing localhost:${port} — make sure \`premo dev ${target.name}\` is running.`);

      const command = provider.command(port);
      const url = await landingUrl(provider, port, ctx);

      if (opts.background) {
        await shareBackground(ctx, target, command, url);
        return;
      }
      await shareForeground(ctx, command, url);
    });
}

export type SharePick =
  | { kind: "ok"; target: Target }
  | { kind: "unknown"; known: string[] } // a named target that doesn't exist
  | { kind: "none" } // nothing serves an HTTP port premo knows
  | { kind: "ambiguous"; choices: string[] }; // several serving targets, no default

// Choose the target to share. Unlike `dev` — whose default may be a compose
// stack with no single premo-known port — `share` needs ONE port it can funnel,
// so with no [target] it selects among the *serving* targets (those with an
// allocated `ports.base`): honor an explicit default if it serves, else the lone
// serving target, else ask. A named target is taken as-is (its port is checked
// downstream). Pure, so the selection is unit-tested without a repo.
export function pickShareTarget(targets: Target[], targetArg?: string): SharePick {
  if (targetArg) {
    const t = targets.find((t) => t.name === targetArg);
    return t ? { kind: "ok", target: t } : { kind: "unknown", known: targets.map((t) => t.name) };
  }
  const def = defaultTarget(targets);
  if (def?.ports?.base !== undefined) return { kind: "ok", target: def };
  const serving = targets.filter((t) => t.ports?.base !== undefined);
  if (serving.length === 1) return { kind: "ok", target: serving[0]! };
  if (serving.length === 0) return { kind: "none" };
  return { kind: "ambiguous", choices: serving.map((t) => t.name) };
}

// The public URL to surface, with the project's `openUrl` path appended so
// collaborators land where `premo open` would (the public sibling of `open`).
async function landingUrl(
  provider: { publicUrl(port: number): Promise<string | null> },
  port: number,
  ctx: Context,
): Promise<string | null> {
  const origin = await provider.publicUrl(port).catch(() => null);
  if (!origin) return null;
  const suffix = pathFromOpenUrl(ctx.manifest.openUrl);
  return suffix && suffix !== "/" ? origin + suffix : origin;
}

// Pull the path+query+hash out of `openUrl` (a localhost template) to graft onto
// the public origin. Returns "" when there's no usable path.
export function pathFromOpenUrl(openUrl?: string): string {
  if (!openUrl) return "";
  try {
    const u = new URL(openUrl.replace("${PORT}", "0"));
    return u.pathname + u.search + u.hash;
  } catch {
    return "";
  }
}

// Foreground: run the tunnel over the inherited TTY so its own output shows and
// Ctrl-C drops the tunnel (the terminal signals the whole foreground group).
async function shareForeground(ctx: Context, command: string, url: string | null): Promise<void> {
  if (url) log.ok(`public: ${url}`);
  log.step(`${command} — Ctrl-C to stop sharing`);
  const res = await execa(command, {
    cwd: ctx.root,
    env: process.env,
    shell: true,
    stdio: "inherit",
    reject: false,
  });
  process.exitCode = res.exitCode ?? 0;
}

// Background: detach via the same supervision `dev --background` uses, so
// `premo logs` / `premo stop` manage it (DESIGN §14.1, decision 28).
async function shareBackground(
  ctx: Context,
  target: Target,
  command: string,
  url: string | null,
): Promise<void> {
  if (process.platform === "win32") {
    log.error("`--background` isn't supported on Windows (supervision uses POSIX process groups).");
    process.exitCode = 1;
    return;
  }
  let proc;
  try {
    proc = await spawnDetached(ctx.root, `share-${target.name}`, command, ctx.root, process.env);
  } catch (err) {
    log.error(`Couldn't start the background tunnel: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  log.ok(
    `sharing ${target.name} → pid ${proc.pid}, logs: ${path.relative(ctx.root, proc.logPath)}`,
  );
  if (url) log.ok(`public: ${url}`);
  log.dim("  `premo logs` to tail, `premo stop` to stop.");
}
