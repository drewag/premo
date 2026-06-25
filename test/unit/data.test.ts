import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectManifest } from "../../src/manifest/types.js";
import {
  mintInstance,
  deleteInstance,
  listInstances,
  dataRunEnv,
  liveDataEnv,
  instanceDir,
  DataError,
} from "../../src/core/data.js";

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
    expect(existsSync(instanceDir(dir, inst.handle))).toBe(true);
    const state = await listInstances(dir);
    expect(state.instances.map((i) => i.handle)).toEqual([inst.handle]);
  });

  it("clone copies a source instance's contents", async () => {
    const dir = await root();
    const m = dirManifest();
    const src = await mintInstance(dir, m, { name: "src" });
    await writeFile(path.join(instanceDir(dir, src.handle), "marker.txt"), "hello");

    const clone = await mintInstance(dir, m, { from: src.handle, name: "copy" });
    expect(clone.from).toBe(src.handle);
    expect(await readFile(path.join(instanceDir(dir, clone.handle), "marker.txt"), "utf8")).toBe(
      "hello",
    );
  });

  it("clone of `live` captures the working dir (golden bootstrap)", async () => {
    const dir = await root();
    const m = dirManifest();
    await mkdir(path.join(dir, ".data"), { recursive: true });
    await writeFile(path.join(dir, ".data", "seed.txt"), "golden");

    const ref = await mintInstance(dir, m, { from: "live", name: "golden" });
    expect(ref.from).toBe("live");
    expect(await readFile(path.join(instanceDir(dir, ref.handle), "seed.txt"), "utf8")).toBe(
      "golden",
    );
  });

  it("injects PREMO_DATA_* + the mapped native var for a run", async () => {
    const dir = await root();
    const m = dirManifest();
    const inst = await mintInstance(dir, m, {});

    const runEnv = await dataRunEnv(dir, m, inst.handle);
    expect(runEnv).toEqual({
      PREMO_DATA_HANDLE: inst.handle,
      PREMO_DATA_DIR: instanceDir(dir, inst.handle),
      DATA_DIR: instanceDir(dir, inst.handle),
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
    expect(await deleteInstance(dir, m, inst.handle)).toBe(true);
    expect(existsSync(instanceDir(dir, inst.handle))).toBe(false);
    expect((await listInstances(dir)).instances).toEqual([]);
    // already gone → quiet success, no throw
    expect(await deleteInstance(dir, m, inst.handle)).toBe(false);
    expect(await deleteInstance(dir, m, "d_never0")).toBe(false);
  });

  it("rejects a clone from an unknown source", async () => {
    const dir = await root();
    await expect(mintInstance(dir, dirManifest(), { from: "d_ghost0" })).rejects.toBeInstanceOf(
      DataError,
    );
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

    expect(await deleteInstance(dir, m, inst.handle)).toBe(true);
    expect(existsSync(path.join(dir, `created-${inst.handle}`))).toBe(false);
  });

  it("rejects clone when neither a clone script nor a dir is wired", async () => {
    const dir = await root();
    const m = wiredManifest();
    const inst = await mintInstance(dir, m, {});
    await expect(mintInstance(dir, m, { from: inst.handle })).rejects.toBeInstanceOf(DataError);
  });
});
