import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectData } from "../../src/core/data-detect.js";

async function root(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-data-detect-"));
}

describe("detectData — standard data shapes", () => {
  it("reads a *_DATA_DIR var from a docker-compose volume (finances shape)", async () => {
    const dir = await root();
    await writeFile(
      path.join(dir, "docker-compose.yml"),
      [
        "services:",
        "  db:",
        "    image: postgres:16",
        "    volumes:",
        "      - ${FINANCES_DATA_DIR:-./.data}/postgres/:/var/lib/postgresql/data/",
      ].join("\n"),
    );
    expect(detectData(dir)).toEqual({
      dir: ".data",
      env: { FINANCES_DATA_DIR: "${PREMO_DATA_DIR}" },
    });
  });

  it("reads a *_DATA_DIR var from an env file (orchestrator shape)", async () => {
    const dir = await root();
    await writeFile(path.join(dir, ".env"), "PORT=3000\nDATA_DIR=.data\n");
    expect(detectData(dir)).toEqual({
      dir: ".data",
      env: { DATA_DIR: "${PREMO_DATA_DIR}" },
    });
  });

  it("maps a sqlite file: url to a templated DATABASE_URL (chess shape)", async () => {
    const dir = await root();
    await mkdir(path.join(dir, "backend"));
    await writeFile(
      path.join(dir, "backend", ".env"),
      'DATABASE_URL="file:../../.data/chess.db"\n',
    );
    expect(detectData(dir)).toEqual({
      dir: ".data",
      env: { DATABASE_URL: "file:${PREMO_DATA_DIR}/chess.db" },
    });
  });

  it("reads a process.env.*DATA_DIR reference from a config source (orchestrator shape)", async () => {
    const dir = await root();
    await mkdir(path.join(dir, "backend", "src"), { recursive: true });
    await writeFile(
      path.join(dir, "backend", "src", "config.ts"),
      'export const dataDir = process.env.DATA_DIR || resolve(REPO_ROOT, ".data");\n',
    );
    expect(detectData(dir)).toEqual({ dir: ".data", env: { DATA_DIR: "${PREMO_DATA_DIR}" } });
  });

  it("prefers a compose *_DATA_DIR var over a sibling postgres DATABASE_URL", async () => {
    const dir = await root();
    await writeFile(
      path.join(dir, "docker-compose.yml"),
      "services:\n  db:\n    volumes:\n      - ${APP_DATA_DIR:-./data}/pg/:/data/",
    );
    await writeFile(path.join(dir, ".env"), "DATABASE_URL=postgres://x@localhost/app\n");
    expect(detectData(dir)).toEqual({ dir: "data", env: { APP_DATA_DIR: "${PREMO_DATA_DIR}" } });
  });

  it("returns undefined when there is no detectable data shape", async () => {
    const dir = await root();
    await writeFile(path.join(dir, ".env"), "PORT=3000\nAPI_KEY=abc\n");
    expect(detectData(dir)).toBeUndefined();
  });
});
