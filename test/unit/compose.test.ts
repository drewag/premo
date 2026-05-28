import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { generateCompose } from "../../src/core/compose.js";
import type { StrandManifest } from "../../src/strand-api/types.js";

const dbStrand: StrandManifest = {
  name: "db",
  version: "0",
  description: "",
  dependsOn: [],
  softDependsOn: [],
  ports: [{ name: "PG_PORT", offset: 20 }],
  skills: [],
  compose: {
    profiles: ["db"],
    services: { db: { image: "postgres:16", ports: ["${PG_PORT}:5432"] } },
    volumes: {},
  },
};

describe("generateCompose", () => {
  it("emits a compose document with the project name and merged services", () => {
    const out = generateCompose({
      projectName: "demo",
      strands: [dbStrand],
      ports: { PG_PORT: 4020 },
      dataDir: "/tmp/demo",
    });
    const parsed = YAML.parse(out.replace(/^#.*$/gm, "").trim());
    expect(parsed.name).toBe("demo");
    expect(parsed.services.db.image).toBe("postgres:16");
  });

  it("throws on duplicate service names across strands", () => {
    expect(() =>
      generateCompose({
        projectName: "demo",
        strands: [dbStrand, { ...dbStrand, name: "other" }],
        ports: { PG_PORT: 4020 },
        dataDir: "/tmp/demo",
      }),
    ).toThrow(/multiple strands/);
  });
});
