import pc from "picocolors";

export interface Footer {
  clear(): void;
}

// A status bar pinned to the terminal's bottom row via a DECSTBM scroll region:
// the region is set to every row *except* the last, so child output scrolls in
// the rows above and physically cannot touch the footer line. Only meaningful
// on a TTY — returns null otherwise (and on terminals too short to spare a row)
// so callers stay non-interactive-safe. The caller MUST invoke clear() on
// teardown to reset the scroll region; an `exit` guard is the last-ditch backstop.
export function installFooter(text: string): Footer | null {
  const out = process.stdout;
  if (!out.isTTY) return null;
  if ((out.rows ?? 0) < 3) return null;

  const render = (): string => {
    const cols = out.columns ?? 80;
    const bar = text.length > cols ? text.slice(0, cols) : text.padEnd(cols, " ");
    return pc.inverse(bar);
  };

  // (Re)reserve the bottom row and draw the bar there, restoring the cursor so
  // scrolling output continues uninterrupted. Setting the region homes the
  // cursor, so we bracket the whole thing in a save/restore (DECSC/DECRC).
  const pin = (): void => {
    const r = out.rows ?? 3;
    out.write(
      "\x1b7" + // save cursor
        `\x1b[1;${r - 1}r` + // scroll region = rows 1..r-1
        `\x1b[${r};1H\x1b[2K` + // jump to the last row, clear it
        render() + // draw the bar (last row is outside the region, so it stays put)
        "\x1b8", // restore cursor
    );
  };

  // The region bottom and the bar width both depend on terminal size.
  const onResize = (): void => pin();

  let cleared = false;
  const clear = (): void => {
    if (cleared) return;
    cleared = true;
    out.off("resize", onResize);
    process.off("exit", clear);
    const r = out.rows ?? 3;
    // Reset the region to the full screen and wipe the bar, leaving the cursor
    // on the (now-empty) bottom row so the next shell prompt lands cleanly.
    out.write("\x1b[r" + `\x1b[${r};1H\x1b[2K`);
  };

  pin();
  out.on("resize", onResize);
  // Never leave the terminal with a stuck scroll region, even on a hard exit.
  process.on("exit", clear);

  return { clear };
}
