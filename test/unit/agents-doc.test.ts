import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { adoptProject } from "../../src/core/context.js";
import {
  upsertManagedBlock,
  ensureAgentsDoc,
  renderAgentsBlock,
  AGENTS_FILE,
  CLAUDE_FILE,
} from "../../src/core/agents-doc.js";
import { gatherSkillContext } from "../../src/core/skill.js";

beforeAll(async () => {
  process.env.PREMO_HOME = await mkdtemp(path.join(tmpdir(), "premo-home-agents-"));
});

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-agents-"));
}

// A minimal but real adopted node app so gatherSkillContext resolves verbs.
async function adoptedRepo(): Promise<string> {
  const root = await tmp();
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "app", scripts: { dev: "vite", build: "tsc", test: "vitest" } }),
  );
  await adoptProject(root, { quiet: true });
  return root;
}

const BLOCK = "<!-- premo:start (x) -->\nBODY\n<!-- premo:end -->";

describe("upsertManagedBlock", () => {
  it("appends to a non-empty file behind a blank line, ending in one newline", () => {
    const out = upsertManagedBlock("# My repo\n\nProse.\n", BLOCK);
    expect(out.startsWith("# My repo\n\nProse.\n\n")).toBe(true);
    expect(out.endsWith("<!-- premo:end -->\n")).toBe(true);
  });

  it("creates just the block (+newline) from an empty file", () => {
    expect(upsertManagedBlock("", BLOCK)).toBe(BLOCK + "\n");
  });

  it("is idempotent — feeding its own output back is byte-stable", () => {
    const once = upsertManagedBlock("# Repo\n", BLOCK);
    expect(upsertManagedBlock(once, BLOCK)).toBe(once);
  });

  it("replaces an existing block in place without duplicating markers", () => {
    const first = upsertManagedBlock("intro\n", BLOCK);
    const updated = upsertManagedBlock(first, "<!-- premo:start (x) -->\nNEW\n<!-- premo:end -->");
    expect(updated.match(/premo:start/g)).toHaveLength(1);
    expect(updated).toContain("NEW");
    expect(updated).not.toContain("BODY");
    expect(updated.startsWith("intro\n")).toBe(true);
  });

  it("preserves prose that follows the block", () => {
    const withTail = "<!-- premo:start (x) -->\nBODY\n<!-- premo:end -->\n\n## Human notes\n";
    const out = upsertManagedBlock(withTail, "<!-- premo:start (x) -->\nNEW\n<!-- premo:end -->");
    expect(out).toContain("## Human notes");
    expect(out).toContain("NEW");
  });
});

describe("renderAgentsBlock", () => {
  it("lists the resolved verb commands for the repo", async () => {
    const ctx = await gatherSkillContext(await adoptedRepo());
    const block = renderAgentsBlock(ctx);
    expect(block).toContain("premo guide");
    expect(block).toContain("`premo dev`");
    // The actual resolved command (not a placeholder) shows up in the table.
    const dev = ctx.wired.find((w) => w.verb === "dev");
    expect(block).toContain(dev!.command);
  });
});

describe("ensureAgentsDoc", () => {
  it("plants the block in AGENTS.md and creates a CLAUDE.md @import", async () => {
    const root = await adoptedRepo();
    // adoptProject already called it once; assert the resulting state.
    const agents = await readFile(path.join(root, AGENTS_FILE), "utf8");
    expect(agents).toContain("managed by [premo]");
    expect(await readFile(path.join(root, CLAUDE_FILE), "utf8")).toBe("@AGENTS.md\n");
  });

  it("is a no-op on re-run — no churn, nothing reported changed", async () => {
    const root = await adoptedRepo();
    const before = await readFile(path.join(root, AGENTS_FILE), "utf8");
    const r = await ensureAgentsDoc(root);
    expect(r.agentsChanged).toBe(false);
    expect(r.claudeCreated).toBeNull();
    expect(await readFile(path.join(root, AGENTS_FILE), "utf8")).toBe(before);
  });

  it("never clobbers a hand-written CLAUDE.md", async () => {
    const root = await tmp();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", scripts: { dev: "vite" } }),
    );
    await writeFile(path.join(root, CLAUDE_FILE), "# my own claude config\n");
    await adoptProject(root, { quiet: true });
    expect(await readFile(path.join(root, CLAUDE_FILE), "utf8")).toBe("# my own claude config\n");
  });

  it("appends its block to a pre-existing hand-written AGENTS.md", async () => {
    const root = await tmp();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", scripts: { dev: "vite" } }),
    );
    await writeFile(path.join(root, AGENTS_FILE), "# House rules\n\nBe nice.\n");
    await adoptProject(root, { quiet: true });
    const agents = await readFile(path.join(root, AGENTS_FILE), "utf8");
    expect(agents).toContain("# House rules");
    expect(agents).toContain("managed by [premo]");
    expect(existsSync(path.join(root, CLAUDE_FILE))).toBe(true);
  });
});
