import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../core/logger.js";
import { saveProject } from "../../core/project.js";
import { resolveStrandSet } from "../../core/strands.js";
import { allocatePorts, DEFAULT_BLOCK, defaultBaseForProject } from "../../core/ports.js";
import { generateCompose } from "../../core/compose.js";
import { renderTree, renderString } from "../../core/templater.js";
import { ProjectManifest, StrandManifest } from "../../strand-api/types.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TEMPLATE = path.resolve(DIR, "../../../templates/root");

export function register(program: Command): void {
  program
    .command("new <name>")
    .description("Scaffold a new strand project.")
    .option("--with <strands>", "comma-separated list of strands", "shared,db,backend,web-app")
    .option("--dir <dir>", "parent directory (default: cwd)")
    .option("--base <port>", "override port base (default: hash-derived in 30000-49999)")
    .action(async (name: string, opts: { with: string; dir?: string; base?: string }) => {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        log.error(`Project name "${name}" must be kebab-case and start with a letter.`);
        process.exit(1);
      }
      const parent = path.resolve(opts.dir ?? process.cwd());
      const projectDir = path.join(parent, name);
      if (existsSync(projectDir)) {
        log.error(`${projectDir} already exists.`);
        process.exit(1);
      }

      const requested = opts.with
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      log.step(`Resolving strands: ${requested.join(", ")}`);
      const resolved = await resolveStrandSet(requested);
      const finalStrandNames = resolved.map((s) => s.manifest.name);
      log.dim(`  → ${finalStrandNames.join(", ")}`);

      const base = opts.base ? parseInt(opts.base, 10) : defaultBaseForProject(name);
      const ports = allocatePorts(
        base,
        DEFAULT_BLOCK,
        resolved.map((s) => s.manifest),
      );
      log.dim(`  → port base ${base} (${opts.base ? "override" : "hash-derived"})`);

      const manifest: ProjectManifest = ProjectManifest.parse({
        name,
        version: "0",
        strands: finalStrandNames,
        ports: { base, block: DEFAULT_BLOCK },
      });

      log.step(`Creating ${projectDir}`);
      await mkdir(projectDir, { recursive: true });

      const vars = {
        projectName: name,
        strandList: JSON.stringify(finalStrandNames),
        workspaces: JSON.stringify(
          resolved.flatMap((s) => (s.manifest.workspace ? [s.manifest.workspace.path] : [])),
        ),
      };

      log.step("Rendering root template");
      await renderTree(ROOT_TEMPLATE, projectDir, vars);

      for (const strand of resolved) {
        const templateDir = path.join(strand.dir, "template");
        if (existsSync(templateDir)) {
          log.step(`Rendering strand: ${strand.manifest.name}`);
          await renderTree(templateDir, projectDir, vars);
        }
      }

      log.step("Generating docker-compose.yml");
      const composeYaml = generateCompose({
        projectName: name,
        strands: resolved.map((s) => s.manifest),
        ports,
        dataDir: `~/.strand-data/${name}`,
      });
      await writeFile(path.join(projectDir, "docker-compose.yml"), composeYaml, "utf8");

      log.step("Composing CLAUDE.md");
      await composeClaude(projectDir, resolved);

      log.step("Copying skills");
      await copySkills(projectDir, resolved);

      log.step("Writing strand.json");
      await saveProject(projectDir, manifest);

      log.ok(`Project ready at ${projectDir}`);
      log.info("");
      log.info(`  cd ${path.relative(process.cwd(), projectDir) || name}`);
      log.info("  yarn install");
      log.info("  strand dev");
    });
}

async function composeClaude(
  projectDir: string,
  strands: Array<{ manifest: StrandManifest; dir: string }>,
): Promise<void> {
  const parts: string[] = [`# ${path.basename(projectDir)}`, ""];
  parts.push("This project was scaffolded with `strand`. Active strands:");
  parts.push("");
  for (const s of strands) parts.push(`- **${s.manifest.name}** — ${s.manifest.description}`);
  parts.push("");
  for (const s of strands) {
    if (!s.manifest.claudeFragment) continue;
    const file = path.join(s.dir, s.manifest.claudeFragment);
    if (!existsSync(file)) continue;
    parts.push(`## ${s.manifest.name}`);
    parts.push("");
    parts.push((await readFile(file, "utf8")).trim());
    parts.push("");
  }
  await writeFile(
    path.join(projectDir, "CLAUDE.md"),
    renderString(parts.join("\n"), { projectName: path.basename(projectDir) }),
    "utf8",
  );
}

async function copySkills(
  projectDir: string,
  strands: Array<{ manifest: StrandManifest; dir: string }>,
): Promise<void> {
  const dest = path.join(projectDir, ".claude", "skills");
  await mkdir(dest, { recursive: true });
  for (const s of strands) {
    const skillsDir = path.join(s.dir, "skills");
    if (!existsSync(skillsDir)) continue;
    await renderTree(skillsDir, dest, { projectName: path.basename(projectDir) });
  }
}
