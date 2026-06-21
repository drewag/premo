import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LOCAL_FILE,
  type BackgroundProc,
  type LocalState,
  ensurePremoGitignore,
  loadLocal,
  saveLocal,
} from "../../src/core/local.js";

// local.ts owns the worktree-local state file + the .gitignore bookkeeping.
// These tests drive the real filesystem against throwaway tmpdir roots.

async function root(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-local-"));
}

function proc(name: string, pid: number): BackgroundProc {
  return {
    name,
    pid,
    pgid: pid,
    logPath: `.runtime/${name}.log`,
    command: "node -e ''",
    startedAt: new Date().toISOString(),
  };
}

describe("loadLocal", () => {
  it("returns an empty shape when no file exists", async () => {
    const dir = await root();
    expect(await loadLocal(dir)).toEqual({});
  });

  it("recovers gracefully from corrupt JSON (returns empty, does not throw)", async () => {
    const dir = await root();
    await writeFile(path.join(dir, LOCAL_FILE), "{ this is not json", "utf8");
    await expect(loadLocal(dir)).resolves.toEqual({});
  });
});

describe("saveLocal / loadLocal round-trip", () => {
  it("round-trips background procs and the last xcode dest", async () => {
    const dir = await root();
    const state: LocalState = {
      background: [proc("dev", 111), proc("api", 222)],
      lastXcodeDest: { dest: "platform=iOS Simulator", label: "iPhone 15", bootUdid: "ABC-123" },
    };
    await saveLocal(dir, state);

    expect(await loadLocal(dir)).toEqual(state);
  });
});

describe("ensurePremoGitignore", () => {
  const entries = [LOCAL_FILE, ".runtime/", ".premo/"];

  it("creates .gitignore with the premo entries", async () => {
    const dir = await root();
    const file = path.join(dir, ".gitignore");
    expect(existsSync(file)).toBe(false);

    await ensurePremoGitignore(dir);

    const content = await readFile(file, "utf8");
    for (const entry of entries) expect(content).toContain(entry);
  });

  it("is idempotent — running twice does not duplicate entries", async () => {
    const dir = await root();
    await ensurePremoGitignore(dir);
    const first = await readFile(path.join(dir, ".gitignore"), "utf8");

    await ensurePremoGitignore(dir);
    const second = await readFile(path.join(dir, ".gitignore"), "utf8");

    expect(second).toBe(first);
    for (const entry of entries) {
      const count = second.split("\n").filter((l) => l.trim() === entry).length;
      expect(count).toBe(1);
    }
  });

  it("appends to an existing .gitignore without clobbering existing lines", async () => {
    const dir = await root();
    const file = path.join(dir, ".gitignore");
    await writeFile(file, "node_modules/\ndist/\n", "utf8");

    await ensurePremoGitignore(dir);

    const content = await readFile(file, "utf8");
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    for (const entry of entries) expect(content).toContain(entry);
  });

  it("does not re-append entries that already exist in the file", async () => {
    const dir = await root();
    const file = path.join(dir, ".gitignore");
    await writeFile(file, `${LOCAL_FILE}\n`, "utf8");

    await ensurePremoGitignore(dir);

    const content = await readFile(file, "utf8");
    const count = content.split("\n").filter((l) => l.trim() === LOCAL_FILE).length;
    expect(count).toBe(1);
    expect(content).toContain(".runtime/");
    expect(content).toContain(".premo/");
  });
});
