import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

export type TemplateVars = Record<string, string>;

const TOKEN_RE = /\{\{(\w+)\}\}/g;

export function renderString(input: string, vars: TemplateVars): string {
  return input.replace(TOKEN_RE, (_match, key) => {
    if (!(key in vars)) {
      throw new Error(`Template token {{${key}}} has no value`);
    }
    return vars[key];
  });
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".zip",
]);

function isBinaryPath(file: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export async function renderTree(
  srcDir: string,
  destDir: string,
  vars: TemplateVars,
): Promise<string[]> {
  const written: string[] = [];
  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const renderedName = renderString(entry, vars);
    const destPath = path.join(destDir, renderedName);
    const s = await stat(srcPath);
    if (s.isDirectory()) {
      written.push(...(await renderTree(srcPath, destPath, vars)));
    } else if (isBinaryPath(srcPath)) {
      const buf = await readFile(srcPath);
      await writeFile(destPath, buf);
      written.push(destPath);
    } else {
      const content = await readFile(srcPath, "utf8");
      await writeFile(destPath, renderString(content, vars), "utf8");
      written.push(destPath);
    }
  }
  return written;
}
