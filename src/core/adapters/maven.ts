import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedPackage } from "./index.js";

// Maven project: a pom.xml at the unit root (Java/Kotlin services, libraries,
// Minecraft plugins, …). One package per unit; a multi-module pom is still ONE
// package — build/test run from the root and Maven's own reactor fans out to
// the modules (premo doesn't split them into per-module packages, mirroring how
// workspaces are the *declared*-monorepo analog for node). Works standalone or
// as a member of a manual monorepo.

async function readPom(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, "pom.xml"), "utf8");
    return raw.replace(/<!--[\s\S]*?-->/g, ""); // comments would confuse the sniffs below
  } catch {
    return null;
  }
}

// The project's own artifactId — the first one OUTSIDE the <parent> block
// (which names the parent, not this project). A cheap regex, not an XML parse:
// it only names a unit, so good-enough beats a dependency.
export function pomArtifactId(pom: string): string | null {
  const own = pom.replace(/<parent\b[\s\S]*?<\/parent>/gi, "");
  return /<artifactId>\s*([^<]+?)\s*<\/artifactId>/i.exec(own)?.[1] ?? null;
}

// Prefer the repo's pinned wrapper over a host mvn when the unit ships one.
function mvn(root: string): string {
  return existsSync(path.join(root, "mvnw")) ? "./mvnw" : "mvn";
}

// `dev` exists only when the pom declares a dev-mode plugin — premo must not
// guess (an honest "no dev" beats running a library). The `env ${PORT:+…}`
// prefix forwards premo's allocated port through the framework's native env var
// (neither reads $PORT itself); `env` is needed because an assignment produced
// by expansion is a command word, not a prefix assignment.
function devCommand(root: string, pom: string): string | null {
  if (pom.includes("spring-boot-maven-plugin")) {
    return `env \${PORT:+SERVER_PORT=$PORT} ${mvn(root)} spring-boot:run`;
  }
  if (pom.includes("quarkus-maven-plugin")) {
    return `env \${PORT:+QUARKUS_HTTP_PORT=$PORT} ${mvn(root)} quarkus:dev`;
  }
  return null;
}

export const mavenAdapter: Adapter = {
  name: "maven",

  async detect(root: string): Promise<boolean> {
    return existsSync(path.join(root, "pom.xml"));
  },

  async packages(root: string): Promise<DetectedPackage[]> {
    const pom = await readPom(root);
    const name = sanitizeProjectName((pom && pomArtifactId(pom)) || path.basename(root));
    // A unit with a dev-mode plugin is a service (piped dev, earns a port);
    // anything else — a library, a plugin — is a command: nothing serves.
    const kind = pom && devCommand(root, pom) ? "service" : "command";
    return [{ name, dirs: ["."], cwd: root, scripts: {}, kind }];
  },

  async command(verb: Verb, _pkg: DetectedPackage, root: string): Promise<string | null> {
    const pom = await readPom(root);
    if (pom === null) return null;
    switch (verb) {
      case "dev":
        return devCommand(root, pom);
      case "build":
        // -DskipTests: `premo test` owns the tests; build shouldn't run them twice.
        return `${mvn(root)} -B package -DskipTests`;
      case "test":
        return `${mvn(root)} -B test`;
      case "lint":
        // Only spotless actually FIXES (the premo lint contract); a check-only
        // tool (checkstyle…) stays unwired rather than pretending to fix.
        return pom.includes("spotless-maven-plugin") ? `${mvn(root)} -B spotless:apply` : null;
      case "deploy":
        return null; // `mvn deploy` publishes to a remote repo — never presume it
    }
  },
};
