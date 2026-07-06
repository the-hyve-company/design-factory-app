import { basename } from "node:path";
import { relTime } from "./df-tui.mjs";

export function parseArgs(argv) {
  const flags = new Set();
  let command = null;
  for (const a of argv) {
    if (a.startsWith("-")) flags.add(a);
    else if (command === null) command = a;
  }
  return { command: command || "start", flags };
}

export function toPanelInstance(e, now) {
  return {
    folder: "…/" + basename(e.folder),
    url: `http://localhost:${e.vitePort}`,
    healthy: e.healthy !== false,
    since: relTime(e.startedAt, now),
  };
}
