import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STRAND_BIN = path.resolve(DIR, "../../bin/strand.ts");
const RUN_HEAVY = process.env.STRAND_E2E === "1";

async function scaffold(name: string, strands: string): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "strand-int-"));
  await execa("npx", ["tsx", STRAND_BIN, "new", name, "--with", strands, "--dir", parent], {
    stdio: "inherit",
  });
  return path.join(parent, name);
}

describe("strand new — scaffolding combos", () => {
  it("scaffolds shared + db + backend", async () => {
    const dir = await scaffold("combo-a", "shared,db,backend");
    expect(existsSync(path.join(dir, "strand.json"))).toBe(true);
    expect(existsSync(path.join(dir, "docker-compose.yml"))).toBe(true);
    expect(existsSync(path.join(dir, "backend", "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "shared", "src", "api", "routes.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(true);
    const manifest = JSON.parse(await readFile(path.join(dir, "strand.json"), "utf8"));
    expect(manifest.strands).toEqual(expect.arrayContaining(["shared", "db", "backend"]));
  });

  it("scaffolds web-app alone", async () => {
    const dir = await scaffold("combo-b", "web-app");
    expect(existsSync(path.join(dir, "web-app", "vite.config.ts"))).toBe(true);
  });

  it("scaffolds the full stack", async () => {
    const dir = await scaffold("combo-c", "shared,db,backend,web-app");
    expect(existsSync(path.join(dir, "shared", "package.json"))).toBe(true);
    expect(existsSync(path.join(dir, "backend", "src", "api.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "web-app", "src", "App.tsx"))).toBe(true);
  });
});

describe.skipIf(!RUN_HEAVY)("strand new — heavy E2E (set STRAND_E2E=1)", () => {
  it("yarn install + yarn test pass on full stack", async () => {
    const dir = await scaffold("combo-e2e", "shared,db,backend,web-app");
    await execa("yarn", ["install"], { cwd: dir, stdio: "inherit" });
    await execa("yarn", ["test"], { cwd: dir, stdio: "inherit" });
  }, 600_000);
});
