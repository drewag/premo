import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { ProjectManifest } from "../../src/manifest/types.js";
import {
  mintInstance,
  linkInstance,
  deleteInstance,
  listInstances,
  dataRunEnv,
  liveDataEnv,
  instanceDir,
  dataHome,
  DataError,
} from "../../src/core/data.js";

// The data registry + instance dirs now live in premo's host-global home, so pin
// PREMO_HOME to a throwaway dir per test (never the real ~/.premo).
let savedHome: string | undefined;
beforeEach(async () => {
  savedHome = process.env.PREMO_HOME;
  process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-data-"));
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.PREMO_HOME;
  else process.env.PREMO_HOME = savedHome;
});

async function root(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-data-"));
}

// A directory-adapter project: state lives under `.data`, mapped onto the app's
// native DATA_DIR var.
function dirManifest() {
  return ProjectManifest.parse({
    name: "app",
    data: { dir: ".data", env: { DATA_DIR: "${PREMO_DATA_DIR}" } },
  });
}

describe("data — directory adapter", () => {
  it("create mints a fresh empty instance dir + registers it", async () => {
    const dir = await root();
    const m = dirManifest();
    const inst = await mintInstance(dir, m, {});
    expect(inst.handle).toMatch(/^d_[0-9a-f]{6}$/);
    expect(existsSync(await instanceDir(dir, inst.handle))).toBe(true);
    const state = await listInstances(dir);
    expect(state.instances.map((i) => i.handle)).toEqual([inst.handle]);
  });

  it("instances live in the global home, not the repo", async () => {
    const dir = await root();
    const inst = await mintInstance(dir, dirManifest(), {});
    const home = await dataHome(dir);
    // Under $PREMO_HOME/data/<slug>/, never inside the checkout.
    expect(home.startsWith(process.env.PREMO_HOME!)).toBe(true);
    expect(await instanceDir(dir, inst.handle)).toBe(path.join(home, inst.handle));
    expect(existsSync(path.join(dir, ".premo", "data"))).toBe(false);
  });

  it("clone copies a source instance's contents", async () => {
    const dir = await root();
    const m = dirManifest();
    const src = await mintInstance(dir, m, { name: "src" });
    await writeFile(path.join(await instanceDir(dir, src.handle), "marker.txt"), "hello");

    const clone = await mintInstance(dir, m, { from: src.handle, name: "copy" });
    expect(clone.from).toBe(src.handle);
    expect(
      await readFile(path.join(await instanceDir(dir, clone.handle), "marker.txt"), "utf8"),
    ).toBe("hello");
  });

  it("clone of `live` captures the working dir (golden bootstrap)", async () => {
    const dir = await root();
    const m = dirManifest();
    await mkdir(path.join(dir, ".data"), { recursive: true });
    await writeFile(path.join(dir, ".data", "seed.txt"), "golden");

    const ref = await mintInstance(dir, m, { from: "live", name: "golden" });
    expect(ref.from).toBe("live");
    expect(await readFile(path.join(await instanceDir(dir, ref.handle), "seed.txt"), "utf8")).toBe(
      "golden",
    );
  });

  it("injects PREMO_DATA_* + the mapped native var for a run", async () => {
    const dir = await root();
    const m = dirManifest();
    const inst = await mintInstance(dir, m, {});
    const idir = await instanceDir(dir, inst.handle);

    const runEnv = await dataRunEnv(dir, m, inst.handle);
    expect(runEnv).toEqual({
      PREMO_DATA_HANDLE: inst.handle,
      PREMO_DATA_DIR: idir,
      DATA_DIR: idir,
    });

    expect(liveDataEnv(dir, m)).toEqual({
      PREMO_DATA_DIR: path.join(dir, ".data"),
      DATA_DIR: path.join(dir, ".data"),
    });
  });

  it("dataRunEnv returns null for an unknown handle", async () => {
    const dir = await root();
    expect(await dataRunEnv(dir, dirManifest(), "d_nope00")).toBeNull();
  });

  it("delete removes the dir + registry entry, and is idempotent", async () => {
    const dir = await root();
    const m = dirManifest();
    const inst = await mintInstance(dir, m, {});
    // delete returns the canonical handle removed…
    expect(await deleteInstance(dir, m, inst.handle)).toBe(inst.handle);
    expect(existsSync(await instanceDir(dir, inst.handle))).toBe(false);
    expect((await listInstances(dir)).instances).toEqual([]);
    // …and null on an already-gone / unknown ref (quiet, no throw)
    expect(await deleteInstance(dir, m, inst.handle)).toBeNull();
    expect(await deleteInstance(dir, m, "d_never0")).toBeNull();
  });

  it("rejects a clone from an unknown source", async () => {
    const dir = await root();
    await expect(mintInstance(dir, dirManifest(), { from: "d_ghost0" })).rejects.toBeInstanceOf(
      DataError,
    );
  });
});

describe("data — referencing by name", () => {
  it("dev --data resolves a name and injects the canonical handle", async () => {
    const dir = await root();
    const m = dirManifest();
    const inst = await mintInstance(dir, m, { name: "golden" });

    const byName = await dataRunEnv(dir, m, "golden");
    const byHandle = await dataRunEnv(dir, m, inst.handle);
    expect(byName).toEqual(byHandle);
    // Even passed a name, the app sees the stable opaque handle.
    expect(byName?.PREMO_DATA_HANDLE).toBe(inst.handle);
  });

  it("clone and delete accept a name", async () => {
    const dir = await root();
    const m = dirManifest();
    const src = await mintInstance(dir, m, { name: "src" });
    await writeFile(path.join(await instanceDir(dir, src.handle), "f.txt"), "x");

    // clone FROM a name → lineage records the resolved handle, not the name.
    const clone = await mintInstance(dir, m, { from: "src", name: "copy" });
    expect(clone.from).toBe(src.handle);

    expect(await deleteInstance(dir, m, "copy")).toBe(clone.handle);
    expect((await listInstances(dir)).instances.map((i) => i.name)).toEqual(["src"]);
  });

  it("an ambiguous name is an error (dev/clone), and quietly false for delete-miss", async () => {
    const dir = await root();
    const m = dirManifest();
    await mintInstance(dir, m, { name: "dup" });
    await mintInstance(dir, m, { name: "dup" });

    await expect(dataRunEnv(dir, m, "dup")).rejects.toBeInstanceOf(DataError);
    await expect(mintInstance(dir, m, { from: "dup" })).rejects.toBeInstanceOf(DataError);
    await expect(deleteInstance(dir, m, "dup")).rejects.toBeInstanceOf(DataError);
    // an entirely unknown ref stays a quiet miss, not a throw
    expect(await dataRunEnv(dir, m, "nope")).toBeNull();
    expect(await deleteInstance(dir, m, "nope")).toBeNull();
  });
});

describe("data — link (custom absolute path)", () => {
  it("registers a handle at an existing dir; dev points the app there", async () => {
    const dir = await root();
    const ext = await mkdtemp(path.join(tmpdir(), "premo-ext-"));
    await writeFile(path.join(ext, "data.txt"), "external");

    const inst = await linkInstance(dir, dirManifest(), ext, { name: "shared" });
    expect(inst.path).toBe(ext);
    expect(inst.from).toBeNull();

    // The instance dir is the external path — premo did NOT copy it under its home.
    expect(await dataRunEnv(dir, dirManifest(), inst.handle)).toEqual({
      PREMO_DATA_HANDLE: inst.handle,
      PREMO_DATA_DIR: ext,
      DATA_DIR: ext,
    });
  });

  it("resolves a relative path against the cwd to an absolute one", async () => {
    const dir = await root();
    const ext = await mkdtemp(path.join(tmpdir(), "premo-ext-"));
    const inst = await linkInstance(dir, dirManifest(), path.relative(process.cwd(), ext));
    expect(inst.path).toBe(path.resolve(ext));
  });

  it("clone of a linked handle copies the external dir into a managed instance", async () => {
    const dir = await root();
    const ext = await mkdtemp(path.join(tmpdir(), "premo-ext-"));
    await writeFile(path.join(ext, "seed.txt"), "from-external");

    const linked = await linkInstance(dir, dirManifest(), ext);
    const clone = await mintInstance(dir, dirManifest(), { from: linked.handle, name: "managed" });
    // The clone is premo-owned (home-derived dir), with the external contents.
    expect(clone.path).toBeUndefined();
    const cloneDir = await instanceDir(dir, clone.handle);
    expect(cloneDir.startsWith(await dataHome(dir))).toBe(true);
    expect(await readFile(path.join(cloneDir, "seed.txt"), "utf8")).toBe("from-external");
  });

  it("delete of a linked handle de-registers but leaves the directory alone", async () => {
    const dir = await root();
    const ext = await mkdtemp(path.join(tmpdir(), "premo-ext-"));
    await writeFile(path.join(ext, "keep.txt"), "keep");

    const inst = await linkInstance(dir, dirManifest(), ext);
    expect(await deleteInstance(dir, dirManifest(), inst.handle)).toBe(inst.handle);
    expect((await listInstances(dir)).instances).toEqual([]);
    // The external dir + its contents survive — premo never owned them.
    expect(existsSync(path.join(ext, "keep.txt"))).toBe(true);
  });

  it("rejects a missing path, a file, and a non-directory-adapter project", async () => {
    const dir = await root();
    await expect(linkInstance(dir, dirManifest(), "/no/such/dir")).rejects.toBeInstanceOf(
      DataError,
    );

    const file = path.join(await mkdtemp(path.join(tmpdir(), "premo-ext-")), "f.txt");
    await writeFile(file, "x");
    await expect(linkInstance(dir, dirManifest(), file)).rejects.toBeInstanceOf(DataError);

    const ext = await mkdtemp(path.join(tmpdir(), "premo-ext-"));
    const wired = ProjectManifest.parse({
      name: "app",
      data: { create: "true", delete: "true" }, // no `dir` → no directory adapter
    });
    await expect(linkInstance(dir, wired, ext)).rejects.toBeInstanceOf(DataError);
  });
});

describe("data — shared across worktrees", () => {
  // The point of the global home: a handle minted in one worktree is listable,
  // clonable, and deletable from any other worktree of the same repo.
  it("a sibling worktree sees, clones, and deletes the same instances", async () => {
    const repo = await root();
    await execa("git", ["init", "-q"], { cwd: repo });
    await execa("git", ["config", "user.email", "t@t.dev"], { cwd: repo });
    await execa("git", ["config", "user.name", "t"], { cwd: repo });
    await writeFile(path.join(repo, "f"), "x");
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-qm", "init"], { cwd: repo });

    const wt = path.join(await mkdtemp(path.join(tmpdir(), "premo-wt-")), "linked");
    await execa("git", ["worktree", "add", "-q", wt, "-b", "feature"], { cwd: repo });

    const m = dirManifest();
    // Both checkouts resolve to one data home (keyed by the main worktree).
    expect(await dataHome(wt)).toBe(await dataHome(repo));

    // Mint in the main checkout…
    const golden = await mintInstance(repo, m, { name: "golden" });
    // …visible from the linked worktree.
    expect((await listInstances(wt)).instances.map((i) => i.handle)).toContain(golden.handle);

    // Clone it from the worktree, then delete it from the main checkout.
    const clone = await mintInstance(wt, m, { from: golden.handle, name: "pr-1" });
    expect(clone.from).toBe(golden.handle);
    expect(await deleteInstance(repo, m, clone.handle)).toBe(clone.handle);
    expect((await listInstances(wt)).instances.map((i) => i.handle)).toEqual([golden.handle]);
  });
});

describe("data — wired contract (no directory adapter)", () => {
  // A pure-wired project: premo just runs the scripts with PREMO_DATA_* injected.
  function wiredManifest() {
    return ProjectManifest.parse({
      name: "app",
      data: {
        create: 'touch "created-$PREMO_DATA_HANDLE"',
        delete: 'rm -f "created-$PREMO_DATA_HANDLE"',
      },
    });
  }

  it("runs the wired create script with the handle injected, then deletes", async () => {
    const dir = await root();
    const m = wiredManifest();
    const inst = await mintInstance(dir, m, {});
    expect(existsSync(path.join(dir, `created-${inst.handle}`))).toBe(true);

    // No directory-adapter env for a pure-wired run — just the handle.
    expect(await dataRunEnv(dir, m, inst.handle)).toEqual({ PREMO_DATA_HANDLE: inst.handle });
    expect(liveDataEnv(dir, m)).toEqual({});

    expect(await deleteInstance(dir, m, inst.handle)).toBe(inst.handle);
    expect(existsSync(path.join(dir, `created-${inst.handle}`))).toBe(false);
  });

  it("rejects clone when neither a clone script nor a dir is wired", async () => {
    const dir = await root();
    const m = wiredManifest();
    const inst = await mintInstance(dir, m, {});
    await expect(mintInstance(dir, m, { from: inst.handle })).rejects.toBeInstanceOf(DataError);
  });
});
