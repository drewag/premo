import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtemp, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  advanceBranchRef,
  changedFiles,
  createTag,
  currentBranch,
  gitRoot,
  headCommit,
  isAncestor,
  isDirty,
  isGitRepo,
  logRange,
  pushRefs,
  refExists,
  resolveBase,
} from "../../src/core/git.js";

// These tests drive real `git` against throwaway repos — the interesting logic in
// git.ts is parsing git's output, and git is a premo prerequisite anyway.

async function g(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "premo-git-"));
  await g(dir, "init", "-b", "main");
  await g(dir, "config", "user.email", "t@example.com");
  await g(dir, "config", "user.name", "Test");
  return dir;
}

async function commit(dir: string, file: string, content: string, msg: string): Promise<void> {
  await writeFile(path.join(dir, file), content);
  await g(dir, "add", "-A");
  await g(dir, "commit", "-m", msg);
}

describe("gitRoot / isGitRepo", () => {
  it("resolves the toplevel inside a repo and null outside", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "a", "init");
    // macOS tmp is a symlink (/var → /private/var); compare realpaths.
    const root = await gitRoot(dir);
    expect(root && path.basename(root)).toBe(path.basename(dir));
    expect(await isGitRepo(dir)).toBe(true);

    const bare = await mkdtemp(path.join(tmpdir(), "premo-nogit-"));
    expect(await gitRoot(bare)).toBeNull();
    expect(await isGitRepo(bare)).toBe(false);
  });
});

describe("resolveBase", () => {
  it("returns null in a fresh repo with no commits", async () => {
    const dir = await initRepo();
    expect(await resolveBase(dir, "origin/main")).toBeNull();
  });

  it("prefers the configured ref, then falls back", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "a", "init");
    expect(await resolveBase(dir, "main")).toBe("main");
    // origin/main doesn't exist → falls through to local main
    expect(await resolveBase(dir, "origin/main")).toBe("main");
  });
});

describe("changedFiles", () => {
  it("unions committed-on-branch with the dirty working tree and reports the base", async () => {
    const dir = await initRepo();
    await commit(dir, "base.txt", "base", "init");
    await g(dir, "checkout", "-b", "feature");
    await commit(dir, "committed.txt", "x", "branch work");
    // an untracked file in the working tree
    await writeFile(path.join(dir, "untracked.txt"), "y");

    const { files, base } = await changedFiles(dir, "main");
    expect(base).toBe("main");
    expect(new Set(files)).toEqual(new Set(["committed.txt", "untracked.txt"]));
  });

  it("parses a staged rename to the new path", async () => {
    const dir = await initRepo();
    await commit(dir, "old.txt", "content", "init");
    await rename(path.join(dir, "old.txt"), path.join(dir, "new.txt"));
    await g(dir, "add", "-A"); // stages the rename → "R  old.txt -> new.txt"

    const { files } = await changedFiles(dir, "main");
    expect(files).toContain("new.txt");
    expect(files).not.toContain("old.txt");
  });
});

describe("commit/branch/dirty helpers", () => {
  it("reports head, branch, and dirtiness", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "a", "init");
    const head = await headCommit(dir);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(await currentBranch(dir)).toBe("main");
    expect(await isDirty(dir)).toBe(false);
    await writeFile(path.join(dir, "b.txt"), "b");
    expect(await isDirty(dir)).toBe(true);
  });
});

describe("logRange", () => {
  it("lists commits in base..tip newest-first with subjects", async () => {
    const dir = await initRepo();
    await commit(dir, "base.txt", "b", "base");
    await g(dir, "checkout", "-b", "feature");
    await commit(dir, "one.txt", "1", "first");
    await commit(dir, "two.txt", "2", "second");

    const log = await logRange(dir, "main", "HEAD");
    expect(log.map((c) => c.subject)).toEqual(["second", "first"]);
    expect(log[0]!.hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe("isAncestor", () => {
  it("is true for base→head and false the other way", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "a", "init");
    const base = (await headCommit(dir))!;
    await commit(dir, "b.txt", "b", "second");
    const head = (await headCommit(dir))!;
    expect(await isAncestor(dir, base, head)).toBe(true);
    expect(await isAncestor(dir, head, base)).toBe(false);
  });
});

describe("ref/tag bookkeeping + push", () => {
  it("advances a branch ref and creates a tag", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "a", "init");
    const head = (await headCommit(dir))!;

    await advanceBranchRef(dir, "deployed/web", head);
    expect(await refExists(dir, "deployed/web")).toBe(true);

    await createTag(dir, "release/web/2026.01.01.1", head);
    expect(await refExists(dir, "release/web/2026.01.01.1")).toBe(true);
  });

  it("pushRefs is false without a remote and true against a bare remote", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "a", "init");
    expect(await pushRefs(dir, ["main"])).toBe(false);

    const remote = await mkdtemp(path.join(tmpdir(), "premo-remote-"));
    await g(remote, "init", "--bare");
    await g(dir, "remote", "add", "origin", remote);
    expect(await pushRefs(dir, ["main"])).toBe(true);
  });
});
