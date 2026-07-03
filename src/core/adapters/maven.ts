import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Verb } from "../../manifest/types.js";
import { sanitizeProjectName } from "../project.js";
import { type Adapter, type DetectedPackage } from "./index.js";

// Read a repo's root pom.xml, or null if there isn't one.
async function readPom(root: string): Promise<string | null> {
  try {
    return await readFile(path.join(root, "pom.xml"), "utf8");
  } catch {
    return null;
  }
}

// The project's own artifactId — the one outside any <parent> block — as the
// package label. A cheap regex, not an XML parse: it only names a unit, so
// good-enough beats a dependency. Falls back to the directory name.
function projectName(pom: string, root: string): string {
  const withoutParent = pom.replace(/<parent\b[\s\S]*?<\/parent>/i, "");
  const m = withoutParent.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/i);
  return sanitizeProjectName(m?.[1] ?? path.basename(root));
}

// Single-module Maven project (Java/Kotlin services, libraries, Minecraft
// plugins, …). Maps the build/test verbs to Maven's lifecycle phases. `dev` and
// `deploy` stay unresolved on purpose: a library has no dev server, and shipping
// is project-specific (a plugin copies its jar onto a server, a webapp deploys
// elsewhere) — those belong in the repo's own premo.json. `lint` maps to
// Spotless only when the project actually configures that plugin.
export const mavenAdapter: Adapter = {
  name: "maven",

  async detect(root: string): Promise<boolean> {
    return existsSync(path.join(root, "pom.xml"));
  },

  async packages(root: string): Promise<DetectedPackage[]> {
    const pom = await readPom(root);
    const name = pom ? projectName(pom, root) : sanitizeProjectName(path.basename(root));
    return [{ name, dirs: ["."], cwd: root, scripts: {}, kind: "command" }];
  },

  async command(verb: Verb, _pkg: DetectedPackage, root: string): Promise<string | null> {
    switch (verb) {
      case "build":
        return "mvn -q clean package";
      case "test":
        return "mvn -q test";
      case "lint": {
        const pom = await readPom(root);
        return pom && /spotless-maven-plugin/.test(pom) ? "mvn -q spotless:apply" : null;
      }
      default:
        return null; // dev / deploy are project-specific
    }
  },
};
