import { createHash } from "node:crypto";

// Default port-base range: [30000, 50000) in 100-port blocks (200 distinct slots).
// Hash-derived so a given project name always lands on the same base across
// machines and clones, while different names almost never collide.
export const DEFAULT_BASE_MIN = 30000;
export const DEFAULT_BASE_MAX = 50000;
export const DEFAULT_BLOCK = 100;
const DEFAULT_SLOTS = (DEFAULT_BASE_MAX - DEFAULT_BASE_MIN) / DEFAULT_BLOCK;

export function defaultBaseForProject(name: string): number {
  const digest = createHash("sha256").update(name).digest();
  const slot = digest.readUInt32BE(0) % DEFAULT_SLOTS;
  return DEFAULT_BASE_MIN + slot * DEFAULT_BLOCK;
}
