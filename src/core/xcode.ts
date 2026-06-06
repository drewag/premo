// Public surface for the xcode adapter's helpers, split across ./xcode/* by
// concern: discovery (locating the project), inspect (adopt-time xcodebuild
// probing), commands (the baked verb strings), destinations (sim/device listing
// + run-target resolution), and env (the PREMO_XCODE_* a verb run needs).
export * from "./xcode/discovery.js";
export * from "./xcode/inspect.js";
export * from "./xcode/commands.js";
export * from "./xcode/destinations.js";
export * from "./xcode/env.js";
