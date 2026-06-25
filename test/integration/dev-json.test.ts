import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPremo } from "./helpers.js";

// A node app whose `dev` server prints noise on stdout + stderr (so we can prove
// child output is kept off premo's stdout), reports the PORT premo injects, then
// self-exits so a foreground `premo dev` run completes without a manual kill.
async function makeDevServerApp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "premo-it-devjson-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "srv", scripts: { dev: "node server.js" } }, null, 2),
  );
  await writeFile(
    path.join(dir, "server.js"),
    [
      'console.log("CHILD_STDOUT_NOISE");',
      'console.error("PORT_SEEN=" + process.env.PORT);',
      "setTimeout(() => process.exit(0), 1500);",
      "",
    ].join("\n"),
  );
  await execa("git", ["init", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("premo dev --json", () => {
  it("prints one parseable descriptor with the resolved port; no noise on stdout", async () => {
    const dir = await makeDevServerApp();
    await runPremo(["adopt"], { cwd: dir });
    const base = JSON.parse((await runPremo(["ports", "--json"], { cwd: dir })).stdout).ports.base;

    const res = await runPremo(["dev", "--json"], { cwd: dir });

    // stdout must be EXACTLY the one descriptor — JSON.parse throws on any stray line.
    const desc = JSON.parse(res.stdout.trim());
    expect(desc.name).toBe("srv");
    expect(desc.target).toBeTruthy();
    expect(desc.background).toBe(false);
    expect(Array.isArray(desc.procs)).toBe(true);
    expect(desc.procs.length).toBeGreaterThan(0);

    const proc = desc.procs[0];
    expect(proc.port).toBe(base);
    expect(proc.url).toBe(`http://localhost:${base}`);
    expect(proc.pid).toBeGreaterThan(0);

    // No child output or human log lines leaked onto stdout…
    expect(res.stdout).not.toContain("CHILD_STDOUT_NOISE");
    expect(res.stdout).not.toContain("dev up");
    expect(res.stdout).not.toContain("Starting");
    // …and the child's output (incl. the injected PORT) landed on stderr instead.
    expect(res.stderr).toContain("CHILD_STDOUT_NOISE");
    expect(res.stderr).toContain(`PORT_SEEN=${base}`);
  }, 30000);

  it("--background prints the descriptor then exits, with the human pid line on stderr", async () => {
    const dir = await makeDevServerApp();
    await runPremo(["adopt"], { cwd: dir });
    const base = JSON.parse((await runPremo(["ports", "--json"], { cwd: dir })).stdout).ports.base;

    const res = await runPremo(["dev", "--json", "--background"], { cwd: dir });
    try {
      const desc = JSON.parse(res.stdout.trim());
      expect(desc.background).toBe(true);
      expect(desc.procs[0].port).toBe(base);
      expect(desc.procs[0].pid).toBeGreaterThan(0);
      // The "→ pid … logs:" confirmation is human output → stderr, not stdout.
      expect(res.stdout).not.toContain("pid ");
      expect(res.stderr).toContain("pid ");
    } finally {
      await runPremo(["stop"], { cwd: dir });
    }
  }, 30000);
});
