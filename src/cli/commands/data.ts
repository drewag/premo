import { Command } from "commander";
import { requireProjectRoot } from "../guard.js";
import { loadProject } from "../../core/project.js";
import { log } from "../../core/logger.js";
import {
  mintInstance,
  linkInstance,
  deleteInstance,
  listInstances,
  DataError,
  type DataInstance,
} from "../../core/data.js";
import type { ProjectManifest } from "../../manifest/types.js";

// premo's first subcommand group (DATA-DIRECTORIES.md §1.1): `data <action>` is a
// resource namespace, kept off the closed verb set on purpose. Every instance
// persists until `delete` — premo has no reaper, so there's no ephemeral/retained
// distinction; a consumer that wants throwaway instances deletes them itself.
// `clone`/`delete` take a required positional reference — a handle or a `--name`
// label (a name matching several instances is an error; use a handle) — `create`
// takes none, and `link` takes a directory path.

function notWired(json: boolean): void {
  if (json) {
    log.json({ error: "data-not-wired" });
  } else {
    log.warn("No data axis wired for this project.");
    log.dim("  set data.dir (directory adapter) or wire data.create/clone/delete in premo.json.");
    log.dim("  See `premo guide`.");
  }
  process.exitCode = 1;
}

// The public shape the consumer parses — never leaks premo-internal location/ref.
// `path` is the exception: it's user-supplied (via `link`), not premo-internal, so
// it's surfaced when present.
function publicInstance(i: DataInstance) {
  return {
    handle: i.handle,
    name: i.name ?? null,
    from: i.from ?? null,
    createdAt: i.createdAt,
    ...(i.path ? { path: i.path } : {}),
  };
}

// Load the project + its data config, or emit the canonical not-wired/not-a-project
// failure and return null. Centralizes the guard the mutating actions share.
async function requireData(
  json: boolean,
): Promise<{ root: string; manifest: ProjectManifest } | null> {
  const root = requireProjectRoot(process.cwd(), { json });
  if (!root) return null;
  const manifest = await loadProject(root);
  if (!manifest.data) {
    notWired(json);
    return null;
  }
  return { root, manifest };
}

// Run a create/clone and report, translating a DataError into the command's failure
// shape instead of a stack trace.
async function runMint(json: boolean, opts: { name?: string; from?: string }): Promise<void> {
  const ctx = await requireData(json);
  if (!ctx) return;
  try {
    const inst = await mintInstance(ctx.root, ctx.manifest, opts);
    if (json) log.json(publicInstance(inst));
    else log.ok(`instance ${inst.handle}` + label(inst));
  } catch (err) {
    if (!(err instanceof DataError)) throw err;
    if (json) log.json({ error: err.message });
    else log.error(err.message);
    process.exitCode = 1;
  }
}

function label(i: DataInstance): string {
  return i.name ? ` (${i.name})` : "";
}

export function register(program: Command): void {
  const data = program
    .command("data")
    .description("Manage isolated data instances (create / clone / link / delete / list).");

  data
    .command("create")
    .description("Mint a fresh isolated data instance.")
    .option("--name <label>", "a human label for the instance")
    .option("--json", "emit machine-readable JSON")
    .action((opts: { name?: string; json?: boolean }) => runMint(!!opts.json, { name: opts.name }));

  data
    .command("clone")
    .description("Mint a copy of an existing instance (or of the live working data).")
    .argument("<handle|name>", "source instance (a handle or name, or `live` for the working data)")
    .option("--name <label>", "a human label for the instance")
    .option("--json", "emit machine-readable JSON")
    .action((handle: string, opts: { name?: string; json?: boolean }) =>
      runMint(!!opts.json, { name: opts.name, from: handle }),
    );

  data
    .command("link")
    .description(
      "Register a handle pointing at an existing directory (not copied; delete only de-registers).",
    )
    .argument("<path>", "an existing directory (absolute, or relative to the cwd)")
    .option("--name <label>", "a human label for the instance")
    .option("--json", "emit machine-readable JSON")
    .action(async (target: string, opts: { name?: string; json?: boolean }) => {
      const ctx = await requireData(!!opts.json);
      if (!ctx) return;
      try {
        const inst = await linkInstance(ctx.root, ctx.manifest, target, { name: opts.name });
        if (opts.json) log.json(publicInstance(inst));
        else log.ok(`linked ${inst.handle}${label(inst)} → ${inst.path}`);
      } catch (err) {
        if (!(err instanceof DataError)) throw err;
        if (opts.json) log.json({ error: err.message });
        else log.error(err.message);
        process.exitCode = 1;
      }
    });

  data
    .command("delete")
    .description("Tear down a data instance. Idempotent.")
    .argument("<handle|name>", "the instance to delete (a handle or name)")
    .option("--json", "emit machine-readable JSON")
    .action(async (ref: string, opts: { json?: boolean }) => {
      const ctx = await requireData(!!opts.json);
      if (!ctx) return;
      try {
        const handle = await deleteInstance(ctx.root, ctx.manifest, ref);
        if (opts.json) log.json({ handle: handle ?? ref, deleted: handle !== null });
        else if (handle) log.ok(`deleted ${handle}`);
        else log.dim(`${ref} — already gone`);
      } catch (err) {
        if (!(err instanceof DataError)) throw err;
        if (opts.json) log.json({ error: err.message });
        else log.error(err.message);
        process.exitCode = 1;
      }
    });

  data
    .command("list")
    .description("List known data instances.")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const root = requireProjectRoot(process.cwd(), { json: opts.json });
      if (!root) return;
      const state = await listInstances(root);
      if (opts.json) {
        log.json({ instances: state.instances.map(publicInstance) });
        return;
      }
      if (state.instances.length === 0) {
        log.dim("No data instances.");
        return;
      }
      log.info(`${state.instances.length} instance(s):`);
      for (const i of state.instances) {
        const origin = i.path ? `  → ${i.path}` : i.from ? `  ← ${i.from}` : "";
        log.dim(`  ${i.handle}${label(i)}${origin}`);
      }
    });
}
