import { execa } from "execa";

// Build dist once before the integration suite so tests drive the real compiled
// binary (which also validates the shipped artifact + its node shebang).
export default async function setup(): Promise<void> {
  await execa("yarn", ["build"], { cwd: process.cwd(), stdio: "inherit" });
}
