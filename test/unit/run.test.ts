import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";

import { ProjectManifest, type ProjectManifestInput } from "../../src/manifest/types.js";
import { runVerb } from "../../src/core/run.js";
import type { Context } from "../../src/core/context.js";

const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;

// Default: every command "succeeds". Individual tests override per command string.
function routeExeca(overrides: Record<string, { exitCode?: number; stdout?: string }> = {}): void {
  mockExeca.mockImplementation(
    async (cmd: string) => overrides[cmd] ?? { exitCode: 0, stdout: "" },
  );
}

// A context with no adapter (empty tmp root) so resolvePackages uses manifest config.
async function ctxWith(extra: Partial<ProjectManifestInput>): Promise<Context> {
  const root = await mkdtemp(path.join(tmpdir(), "premo-run-"));
  const manifest = ProjectManifest.parse({ name: "demo", ...extra });
  return { root, manifest };
}

const TWO_TARGETS: Partial<ProjectManifestInput> = {
  packages: [
    { name: "api", dirs: ["api/"], commands: { build: "build-api" } },
    { name: "web", dirs: ["web/"], commands: { build: "build-web" } },
  ],
};

// commands actually run (the verb commands), in call order
function ranCommands(): string[] {
  return mockExeca.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  routeExeca();
  process.exitCode = 0;
});
afterEach(() => {
  mockExeca.mockReset();
  process.exitCode = 0;
});

describe("runVerb", () => {
  it("runs a single named target's command with cwd/env", async () => {
    const ctx = await ctxWith(TWO_TARGETS);
    await runVerb(ctx, "build", { target: "web", affected: false, env: { FOO: "bar" } });
    expect(ranCommands()).toEqual(["build-web"]);
    const opts = mockExeca.mock.calls[0]![1] as { shell?: boolean; env?: NodeJS.ProcessEnv };
    expect(opts.shell).toBe(true);
    expect(opts.env).toEqual({ FOO: "bar" });
    expect(process.exitCode).toBe(0);
  });

  it("runs every target with --all", async () => {
    const ctx = await ctxWith(TWO_TARGETS);
    await runVerb(ctx, "build", { all: true, affected: false });
    expect(new Set(ranCommands())).toEqual(new Set(["build-api", "build-web"]));
  });

  it("stops on the first failure and propagates the exit code", async () => {
    const ctx = await ctxWith(TWO_TARGETS);
    routeExeca({ "build-api": { exitCode: 2 } }); // api sorts first
    await runVerb(ctx, "build", { all: true, affected: false });
    expect(ranCommands()).toEqual(["build-api"]); // build-web never runs
    expect(process.exitCode).toBe(2);
  });

  it("warns and fails when no command resolves for the verb", async () => {
    const ctx = await ctxWith(TWO_TARGETS);
    await runVerb(ctx, "deploy", { all: true, affected: false });
    expect(ranCommands()).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("fails on an unknown target without running anything", async () => {
    const ctx = await ctxWith(TWO_TARGETS);
    await runVerb(ctx, "build", { target: "nope", affected: false });
    expect(ranCommands()).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("narrows to the affected set from affectedCommand", async () => {
    const ctx = await ctxWith({ ...TWO_TARGETS, affectedCommand: "list-affected" });
    routeExeca({ "list-affected": { exitCode: 0, stdout: "web" } });
    await runVerb(ctx, "build", { affected: true });
    expect(ranCommands()).toEqual(["list-affected", "build-web"]); // api filtered out
    expect(process.exitCode).toBe(0);
  });
});
