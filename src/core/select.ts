import readline from "node:readline";
import pc from "picocolors";

export interface SelectOptions {
  header?: string;
  defaultIndex?: number;
}

// A single-select arrow-key menu drawn in place on the TTY. Returns the chosen
// index, or null if the user aborts (Esc / q). Ctrl-C exits the process. When
// stdin/stdout isn't a TTY (piped, CI) it returns the default without drawing,
// so callers stay non-interactive-safe.
export async function selectFromList(
  items: string[],
  opts: SelectOptions = {},
): Promise<number | null> {
  const n = items.length;
  if (n === 0) return null;
  let idx = Math.min(Math.max(opts.defaultIndex ?? 0, 0), n - 1);

  const out = process.stdout;
  if (!process.stdin.isTTY || !out.isTTY) return idx;

  if (opts.header) out.write(opts.header + "\n");

  const draw = (first: boolean) => {
    if (!first) out.write(`\x1b[${n}A`); // back to the first row
    for (let i = 0; i < n; i++) {
      const selected = i === idx;
      const pointer = selected ? pc.cyan("❯ ") : "  ";
      const text = selected ? pc.cyan(items[i]!) : items[i]!;
      out.write(`\x1b[2K${pointer}${text}\n`); // clear line, then the row
    }
  };
  draw(true);

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw ?? false;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<number | null>((resolve) => {
    const finish = (result: number | null) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve(result);
    };
    const onKey = (_str: string, key: readline.Key | undefined) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        process.stdin.setRawMode(wasRaw);
        out.write("\n");
        process.exit(130);
      } else if (key.name === "up" || key.name === "k") {
        idx = (idx - 1 + n) % n;
        draw(false);
      } else if (key.name === "down" || key.name === "j") {
        idx = (idx + 1) % n;
        draw(false);
      } else if (key.name === "return" || key.name === "enter") {
        finish(idx);
      } else if (key.name === "escape" || key.name === "q") {
        finish(null);
      }
    };
    process.stdin.on("keypress", onKey);
  });
}

export interface MultiSelectOptions {
  header?: string;
  preselected?: boolean[];
}

// A checkbox multi-select drawn in place on the TTY: ↑/↓ (or j/k) move, space
// toggles, a toggles all, enter confirms. Returns the chosen indices, or null on
// abort (Esc / q). Ctrl-C exits the process. Off a TTY (piped/CI) it returns the
// preselected set without drawing, so callers stay non-interactive-safe.
export async function multiSelectFromList(
  items: string[],
  opts: MultiSelectOptions = {},
): Promise<number[] | null> {
  const n = items.length;
  const checked = items.map((_, i) => opts.preselected?.[i] ?? false);
  const chosen = () => checked.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (n === 0) return [];

  const out = process.stdout;
  if (!process.stdin.isTTY || !out.isTTY) return chosen();

  let idx = 0;
  if (opts.header) out.write(opts.header + "\n");

  const draw = (first: boolean) => {
    if (!first) out.write(`\x1b[${n}A`);
    for (let i = 0; i < n; i++) {
      const cursor = i === idx;
      const pointer = cursor ? pc.cyan("❯ ") : "  ";
      const box = checked[i] ? pc.green("[x] ") : "[ ] ";
      const text = cursor ? pc.cyan(items[i]!) : items[i]!;
      out.write(`\x1b[2K${pointer}${box}${text}\n`);
    }
  };
  draw(true);

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw ?? false;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<number[] | null>((resolve) => {
    const finish = (result: number[] | null) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve(result);
    };
    const onKey = (_str: string, key: readline.Key | undefined) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        process.stdin.setRawMode(wasRaw);
        out.write("\n");
        process.exit(130);
      } else if (key.name === "up" || key.name === "k") {
        idx = (idx - 1 + n) % n;
        draw(false);
      } else if (key.name === "down" || key.name === "j") {
        idx = (idx + 1) % n;
        draw(false);
      } else if (key.name === "space") {
        checked[idx] = !checked[idx];
        draw(false);
      } else if (key.name === "a") {
        const all = checked.some((c) => !c);
        for (let i = 0; i < n; i++) checked[i] = all;
        draw(false);
      } else if (key.name === "return" || key.name === "enter") {
        finish(chosen());
      } else if (key.name === "escape" || key.name === "q") {
        finish(null);
      }
    };
    process.stdin.on("keypress", onKey);
  });
}
