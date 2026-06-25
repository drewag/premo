import os from "node:os";
import path from "node:path";

// premo's host-global home: the one directory outside any repo that premo writes
// to. Holds the port-block registry (port-registry.ts) and the global data home
// (data.ts). Overridable via PREMO_HOME so tests — and a consumer that wants an
// isolated sandbox — can redirect it.
export function premoHome(): string {
  return process.env.PREMO_HOME ?? path.join(os.homedir(), ".premo");
}
