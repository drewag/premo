import { execa } from "execa";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../dist/bin/premo.js");

export interface PremoResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Run the compiled premo binary in a fixture. PREMO_HOME is pinned under the
// fixture so the global port registry stays isolated from ~/.premo and other
// fixtures, and persists across calls within one fixture.
export async function runPremo(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<PremoResult> {
  const res = await execa("node", [DIST_BIN, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, PREMO_HOME: path.join(opts.cwd, ".premo-home"), ...opts.env },
    reject: false,
  });
  return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode ?? 0 };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}

// Init a git repo on `main` with a committed identity + seed commit, so the
// affected primitive (merge-base origin/main → main fallback) has a base.
async function gitInit(dir: string): Promise<void> {
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "init");
}

async function tmp(label: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `premo-it-${label}-`));
}

async function writeJson(file: string, obj: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(obj, null, 2));
}

// A single-package node app whose verbs echo recognizable markers.
export async function makeNodeApp(scripts?: Record<string, string>): Promise<string> {
  const dir = await tmp("node");
  await writeJson(path.join(dir, "package.json"), {
    name: "app",
    scripts: scripts ?? {
      build: "echo BUILD_OK",
      lint: "echo LINT_OK",
      test: "echo TEST_OK",
    },
  });
  await gitInit(dir);
  return dir;
}

// A workspaces monorepo with two packages, each build echoing its marker.
export async function makeWorkspaces(): Promise<string> {
  const dir = await tmp("ws");
  await writeJson(path.join(dir, "package.json"), {
    name: "mono",
    private: true,
    workspaces: ["packages/*"],
  });
  for (const name of ["a", "b"]) {
    const pkg = path.join(dir, "packages", name);
    await mkdir(pkg, { recursive: true });
    await writeJson(path.join(pkg, "package.json"), {
      name,
      scripts: { build: `echo AFFECTED_${name.toUpperCase()}` },
    });
  }
  await gitInit(dir);
  return dir;
}

// A manual monorepo (no `workspaces` field): a root with a dev-tool bin + a
// central deploy:<name> script, and member packages discovered one level deep.
// `api` and `web` are serving targets (have a dev); `shared` is a library.
export async function makeManualMonorepo(): Promise<string> {
  const dir = await tmp("mono");
  await writeJson(path.join(dir, "package.json"), {
    name: "mono",
    bin: { mono: "./bin/dev.ts" },
    scripts: { "deploy:web": "echo DEPLOYED_WEB" },
  });
  const members: Record<string, Record<string, string>> = {
    api: { dev: "echo APIDEV", build: "echo AFFECTED_API", test: "echo TEST_API" },
    web: { dev: "echo WEBDEV", build: "echo AFFECTED_WEB" },
    shared: { test: "echo TEST_SHARED" }, // library: no dev/deploy → not a target
  };
  for (const [name, scripts] of Object.entries(members)) {
    const p = path.join(dir, name);
    await mkdir(p, { recursive: true });
    await writeJson(path.join(p, "package.json"), { name, scripts });
  }
  await gitInit(dir);
  return dir;
}

// A single-package node app whose build echoes a variable from a root `.env`,
// to prove premo loads the repo env into verb runs.
export async function makeNodeAppWithDotenv(): Promise<string> {
  const dir = await tmp("env");
  await writeJson(path.join(dir, "package.json"), {
    name: "app",
    scripts: { build: "echo VAL=$FROM_DOTENV" },
  });
  await writeFile(path.join(dir, ".env"), "FROM_DOTENV=from_dotenv\n");
  await gitInit(dir);
  return dir;
}

// A CLI-style package (has a `bin`).
export async function makeCli(): Promise<string> {
  const dir = await tmp("cli");
  await writeJson(path.join(dir, "package.json"), {
    name: "tool",
    bin: { tool: "./dist/cli.js" },
    scripts: { build: "echo BUILD_OK" },
  });
  await gitInit(dir);
  return dir;
}

// Make an uncommitted edit inside a path (to mark a target affected).
export async function dirtyEdit(dir: string, file: string): Promise<void> {
  await writeFile(path.join(dir, file), `changed ${file}`);
}
