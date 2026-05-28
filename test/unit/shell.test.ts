import { describe, expect, it } from "vitest";
import { buildShellInvocation } from "../../src/cli/commands/shell.js";
import type { LoadedStrand } from "../../src/core/strands.js";
import type { StrandManifest } from "../../src/strand-api/types.js";

function strand(name: string, shell: StrandManifest["shell"]): LoadedStrand {
  return {
    dir: `/tmp/fake/${name}`,
    manifest: {
      name,
      version: "0",
      description: "",
      dependsOn: [],
      softDependsOn: [],
      ports: [],
      skills: [],
      shell,
    },
  };
}

describe("buildShellInvocation", () => {
  const env = { PG_PORT: "45920" };
  const root = "/tmp/proj";

  it("builds a compose-exec argv", () => {
    const s = strand("db", {
      kind: "compose-exec",
      service: "db",
      command: ["psql", "-U", "app", "-d", "app"],
    });
    const built = buildShellInvocation(s, env, root, undefined);
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
    const s = strand("db", {
      kind: "compose-exec",
      service: "db",
      command: ["psql", "-U", "app"],
    });
    const built = buildShellInvocation(s, env, root, "SELECT 1");
    expect(built.argv).toEqual(["docker", "compose", "exec", "db", "sh", "-c", "SELECT 1"]);
  });

  it("builds a raw command invocation", () => {
    const s = strand("custom", {
      kind: "command",
      command: ["bash", "-i"],
    });
    const built = buildShellInvocation(s, env, root, undefined);
    expect(built.argv).toEqual(["bash", "-i"]);
  });

  it("interpolates ${VAR} tokens from env", () => {
    const s = strand("db", {
      kind: "compose-exec",
      service: "db",
      command: ["psql", "-p", "${PG_PORT}"],
    });
    const built = buildShellInvocation(s, env, root, undefined);
    expect(built.argv).toContain("45920");
  });

  it("throws if the strand has no shell declared", () => {
    const s = strand("none", undefined);
    expect(() => buildShellInvocation(s, env, root, undefined)).toThrow(/does not declare a shell/);
  });
});
