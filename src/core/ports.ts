import { createHash } from "node:crypto";
import { StrandManifest } from "../strand-api/types.js";

export type PortAllocation = Record<string, number>;

const AIRPLAY_RANGE = { from: 5000, to: 5100 };

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

export function allocatePorts(
  base: number,
  block: number,
  strands: StrandManifest[],
): PortAllocation {
  const allocation: PortAllocation = {};
  const usedOffsets = new Set<number>();

  for (const strand of strands) {
    for (const port of strand.ports) {
      if (usedOffsets.has(port.offset)) {
        throw new Error(
          `Port offset ${port.offset} (${port.name}) collides with another strand. ` +
            `Each strand must claim a unique offset within the port block.`,
        );
      }
      if (port.offset >= block) {
        throw new Error(`Port offset ${port.offset} (${port.name}) exceeds block size ${block}.`);
      }
      const port_ = base + port.offset;
      if (port_ >= AIRPLAY_RANGE.from && port_ < AIRPLAY_RANGE.to) {
        throw new Error(
          `Port ${port_} (${port.name}) falls inside the macOS AirPlay range (${AIRPLAY_RANGE.from}-${AIRPLAY_RANGE.to}). Choose a different base.`,
        );
      }
      usedOffsets.add(port.offset);
      allocation[port.name] = port_;
    }
  }
  return allocation;
}
