import { describe, expect, it } from "vitest";
import { buildShellInvocation } from "../../src/cli/commands/shell.js";
import type { ShellSpec } from "../../src/strand-api/types.js";

describe("buildShellInvocation", () => {
  const env = { PG_PORT: "45920" };
  const root = "/tmp/proj";

  it("builds a compose-exec argv", () => {
    const spec: ShellSpec = {
      kind: "compose-exec",
      service: "db",
      command: ["psql", "-U", "app", "-d", "app"],
    };
    const built = buildShellInvocation(spec, env, root, undefined);
    expect(built.argv).toEqual([
      "docker",
      "compose",
      "exec",
      "db",
      "psql",
      "-U",
      "app",
      "-d",
      "app",
    ]);
    expect(built.cwd).toBe(root);
  });

  it("substitutes the -c override into a compose-exec call", () => {
    const spec: ShellSpec = { kind: "compose-exec", service: "db", command: ["psql", "-U", "app"] };
    const built = buildShellInvocation(spec, env, root, "SELECT 1");
    expect(built.argv).toEqual(["docker", "compose", "exec", "db", "sh", "-c", "SELECT 1"]);
  });

  it("builds a raw command invocation", () => {
    const spec: ShellSpec = { kind: "command", command: ["bash", "-i"] };
    const built = buildShellInvocation(spec, env, root, undefined);
    expect(built.argv).toEqual(["bash", "-i"]);
  });

  it("interpolates ${VAR} tokens from env", () => {
    const spec: ShellSpec = {
      kind: "compose-exec",
      service: "db",
      command: ["psql", "-p", "${PG_PORT}"],
    };
    const built = buildShellInvocation(spec, env, root, undefined);
    expect(built.argv).toContain("45920");
  });
});
