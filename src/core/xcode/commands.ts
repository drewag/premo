import { shq } from "../shell.js";

// The baked verb commands. Project + scheme are stable (baked here); only the
// destination varies per run, threaded in as PREMO_XCODE_DEST. dev also reads
// PREMO_XCODE_BUNDLE_ID and routes on the destination kind: a physical device
// (PREMO_XCODE_DEVICE_UDID) installs/launches via devicectl, a simulator
// (PREMO_XCODE_BOOT_UDID) via simctl, and macOS execs the built .app's binary
// directly (not `open`) so the app is a real child of the dev process: its
// stdout/stderr stream to the console, SIGTERM kills it on quit, and a restart
// relaunches the fresh build instead of just refocusing the stale instance.
export function xcodeCommands(
  flag: string,
  scheme: string,
): { dev: string; build: string; test: string } {
  const base = `xcodebuild ${flag} -scheme ${shq(scheme)}`;
  const built = `${base} -configuration Debug -destination "$PREMO_XCODE_DEST" -derivedDataPath "$DD"`;
  const dev = [
    `set -e`,
    `DD=.premo/xcode-dd`,
    // Quiet by default ($PREMO_XCODE_QUIET = -quiet): only warnings/errors during
    // the build, then the running app's logs stream as usual. `dev -v` clears it.
    `if [ -n "$PREMO_XCODE_QUIET" ]; then echo "▸ Building… (pass -v for full xcodebuild logs)"; fi`,
    `${built} $PREMO_XCODE_QUIET build`,
    // Resolve the exact product for THIS destination from build settings, so a
    // stale simulator build is never installed on a device (or vice-versa) —
    // both can coexist under Build/Products as Debug-iphone{simulator,os}.
    `S=$(${built} -showBuildSettings 2>/dev/null)`,
    `TBD=$(printf '%s\\n' "$S" | sed -n 's/^ *TARGET_BUILD_DIR = //p' | head -1)`,
    `WN=$(printf '%s\\n' "$S" | sed -n 's/^ *WRAPPER_NAME = //p' | head -1)`,
    `EP=$(printf '%s\\n' "$S" | sed -n 's/^ *EXECUTABLE_PATH = //p' | head -1)`,
    // Bundle id for the install/launch step. Prefer the baked PREMO_XCODE_BUNDLE_ID
    // (from an adopted xcode block), else read it from this build's settings — so a
    // detected-but-not-yet-adopted app still launches without a baked id.
    `BID="\${PREMO_XCODE_BUNDLE_ID:-$(printf '%s\\n' "$S" | sed -n 's/^ *PRODUCT_BUNDLE_IDENTIFIER = //p' | head -1)}"`,
    `APP="$TBD/$WN"`,
    `if [ ! -d "$APP" ]; then echo "premo: no built .app for this destination ($APP)" >&2; exit 1; fi`,
    `if [ -n "$PREMO_XCODE_DEVICE_UDID" ]; then`,
    `  xcrun devicectl device install app --device "$PREMO_XCODE_DEVICE_UDID" "$APP"`,
    `  exec xcrun devicectl device process launch --console --terminate-existing --device "$PREMO_XCODE_DEVICE_UDID" "$BID"`,
    `elif [ -n "$PREMO_XCODE_BOOT_UDID" ]; then`,
    `  xcrun simctl boot "$PREMO_XCODE_BOOT_UDID" 2>/dev/null || true`,
    `  open -a Simulator || true`,
    `  xcrun simctl install "$PREMO_XCODE_BOOT_UDID" "$APP"`,
    `  exec xcrun simctl launch --console-pty "$PREMO_XCODE_BOOT_UDID" "$BID"`,
    `else`,
    // Exec the binary inside the .app bundle directly (not `open`): the app then
    // runs as a child of this process, so its logs stream here and a SIGTERM on
    // restart/quit actually terminates it. `open` would hand it to launchd, where
    // we can't kill it and a relaunch just refocuses the stale instance.
    `  exec "$TBD/$EP"`,
    `fi`,
  ].join("\n");
  return {
    dev,
    build: `${base} -destination "$PREMO_XCODE_DEST" build`,
    test: `${base} -destination "$PREMO_XCODE_DEST" test`,
  };
}
