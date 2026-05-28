import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderString, renderTree } from "../../src/core/templater.js";

describe("renderString", () => {
  it("replaces tokens", () => {
    expect(renderString("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("supports multiple tokens", () => {
    expect(renderString("{{a}}/{{b}}", { a: "x", b: "y" })).toBe("x/y");
  });

  it("throws on missing token", () => {
    expect(() => renderString("hi {{missing}}", {})).toThrow(/missing/);
  });

  it("leaves non-token text alone", () => {
    expect(renderString("plain text", {})).toBe("plain text");
  });
});

describe("renderTree", () => {
  it("renders file contents and file names", async () => {
    const src = await mkdtemp(path.join(tmpdir(), "strand-tplsrc-"));
    const dest = await mkdtemp(path.join(tmpdir(), "strand-tpldst-"));
    await mkdir(path.join(src, "sub"), { recursive: true });
    await writeFile(path.join(src, "{{projectName}}.txt"), "hello {{projectName}}");
    await writeFile(path.join(src, "sub", "static.txt"), "no tokens here");

    await renderTree(src, dest, { projectName: "myapp" });

    expect(await readFile(path.join(dest, "myapp.txt"), "utf8")).toBe("hello myapp");
    expect(await readFile(path.join(dest, "sub", "static.txt"), "utf8")).toBe("no tokens here");
  });
});
