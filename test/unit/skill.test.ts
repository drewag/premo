import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatherSkillContext, renderSkill } from "../../src/core/skill.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-skill-"));
}

describe("skill tier", () => {
  it("reports no adapter, all verbs unwired, and the right signal for a Makefile repo", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "Makefile"), "build:\n\techo hi\n");

    const ctx = await gatherSkillContext(root);
    expect(ctx.adapter).toBeNull();
    expect(ctx.wired).toHaveLength(0);
    expect(ctx.unwired).toEqual(["dev", "build", "test", "lint", "deploy"]);
    expect(ctx.signals.map((s) => s.label)).toContain("Makefile");
  });

  it("detects an adapter and splits wired/unwired verbs for a node repo", async () => {
    const root = await tmp();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", scripts: { build: "tsc", test: "vitest" } }),
    );

    const ctx = await gatherSkillContext(root);
    expect(ctx.adapter).toBe("node-scripts");
    expect(ctx.wired.map((w) => w.verb)).toEqual(["build", "test"]);
    expect(ctx.unwired).toContain("lint");
    expect(ctx.signals.map((s) => s.label)).toContain("package.json");
  });

  it("renders a SKILL.md that names the project, the missing verbs, and the signals", async () => {
    const doc = renderSkill({
      name: "myapp",
      root: "/tmp/myapp",
      adapter: null,
      wired: [{ verb: "build", command: "make build" }],
      unwired: ["dev", "test"],
      signals: [{ label: "Makefile", hint: "Make — `make <target>` per verb." }],
    });
    expect(doc).toContain("wire up `myapp`");
    expect(doc).toContain("`build` → `make build`");
    expect(doc).toContain("Makefile");
    // every closed verb is described in the contract table
    for (const v of ["dev", "build", "test", "lint", "deploy"]) {
      expect(doc).toContain(`\`${v}\``);
    }
  });
});
