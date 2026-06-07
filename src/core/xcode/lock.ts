// Does this `xcrun devicectl` install/launch output indicate the target device
// is locked? devicectl phrases it a few ways across OS versions ("the device is
// locked", "Unlock the device and try again", "could not be unlocked", "Please
// unlock …"), so we match the stable fragments rather than a single string.
// Callers only consult this after a physical-device run has already failed, so
// a stray match in app logs is harmless — it can't fire on a healthy run.
const LOCKED_PATTERNS: RegExp[] = [
  /\bdevice (?:is|was) locked\b/i,
  /\bcould not be,? unlocked\b/i,
  /\bunlock (?:the|your) (?:device|iphone|ipad)\b/i,
  /\bplease unlock\b/i,
];

export function isDeviceLockedError(output: string): boolean {
  return LOCKED_PATTERNS.some((re) => re.test(output));
}
