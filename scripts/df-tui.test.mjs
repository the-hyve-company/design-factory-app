import { describe, it, expect } from "vitest";
import {
  renderPanel,
  makeStyles,
  relTime,
  createPainter,
  stripAnsi,
  PANEL_WIDTH,
} from "./df-tui.mjs";

const READY = {
  kind: "ready",
  mode: "prod",
  version: "1.1.1",
  steps: [
    { status: "ok", label: "Ambiente", detail: "node 22 · deps ok" },
    { status: "ok", label: "Daemon", detail: ":1421 · healthy" },
    { status: "run", label: "Web", detail: ":1420 · subindo…" },
  ],
  url: "http://localhost:1420",
};

const CONFLICT = {
  kind: "conflict",
  folder: "…/design-factory",
  url: "http://localhost:1420",
  healthy: true,
  since: "há 8 min",
};

const STATUS = {
  kind: "status",
  instances: [
    { folder: "…/clone-a", url: ":1420", healthy: true, since: "há 8 min" },
    { folder: "…/clone-b", url: ":1430", healthy: false, since: "há 2h" },
  ],
};

// Every visible line of a panel is exactly width+2 (the two side borders).
function assertRectangular(panel, width) {
  const lines = stripAnsi(panel).split("\n");
  for (const line of lines) {
    expect([...line].length).toBe(width + 2);
  }
  return lines;
}

describe("df-tui renderPanel", () => {
  it("ready panel is a perfect rectangle (default width)", () => {
    const lines = assertRectangular(renderPanel(READY), PANEL_WIDTH);
    expect(lines[0]).toMatch(/^╭─+╮$/);
    expect(lines[lines.length - 1]).toMatch(/^╰─+╯$/);
    expect(lines.some((l) => l.includes("┤"))).toBe(true); // command-bar divider
  });

  it("ready panel honors a custom width", () => {
    assertRectangular(renderPanel(READY, { width: 64 }), 64);
  });

  it("ready panel shows header, url and command keys", () => {
    const p = stripAnsi(renderPanel(READY));
    expect(p).toContain("DESIGN FACTORY");
    expect(p).toContain("prod · 1.1.1");
    expect(p).toContain("http://localhost:1420");
    expect(p).toContain("abrir");
    expect(p).toContain("sair");
  });

  it("renders step icons by status", () => {
    const p = stripAnsi(renderPanel(READY));
    expect(p).toContain("✓"); // ok steps
    expect(p).toContain("⟳"); // running step
  });

  it("conflict panel is rectangular and shows the three choices", () => {
    assertRectangular(renderPanel(CONFLICT), PANEL_WIDTH);
    const p = stripAnsi(renderPanel(CONFLICT));
    expect(p).toContain("já está rodando");
    expect(p).toContain("assumir aqui");
    expect(p).toContain("abrir a que já está rodando");
    expect(p).toContain("subir do lado");
    expect(p).toContain("healthy");
  });

  it("status panel lists instances; empty state when none", () => {
    assertRectangular(renderPanel(STATUS), PANEL_WIDTH);
    const p = stripAnsi(renderPanel(STATUS));
    expect(p).toContain("clone-a");
    expect(p).toContain("clone-b");
    const empty = stripAnsi(renderPanel({ kind: "status", instances: [] }));
    expect(empty).toContain("nenhuma instância rodando");
  });

  it("error panel shows title and message lines", () => {
    const p = stripAnsi(
      renderPanel({ kind: "error", title: "boom", lines: ["linha 1", "linha 2"] }),
    );
    expect(p).toContain("✗");
    expect(p).toContain("boom");
    expect(p).toContain("linha 1");
    expect(p).toContain("linha 2");
  });

  it("unknown kind falls back to the ready renderer", () => {
    const p = stripAnsi(renderPanel({ kind: "whatever", steps: [], mode: "dev", version: "9" }));
    expect(p).toContain("DESIGN FACTORY");
  });
});

describe("df-tui color", () => {
  it("color off → no ANSI escapes", () => {
    const p = renderPanel(READY, { color: false });
    expect(p).toBe(stripAnsi(p));
  });

  it("color on → contains ANSI escapes", () => {
    const p = renderPanel(READY, { color: true });
    expect(p).not.toBe(stripAnsi(p));
    expect(p).toContain("\x1b[");
  });

  it("makeStyles identity when color off", () => {
    const S = makeStyles(false);
    expect(S.orange("x")).toBe("x");
    const C = makeStyles(true);
    expect(C.orange("x")).not.toBe("x");
  });
});

describe("relTime", () => {
  it("formats seconds / minutes / hours / days", () => {
    const base = 1_000_000_000_000;
    expect(relTime(base, base + 5_000)).toBe("há 5s");
    expect(relTime(base, base + 8 * 60_000)).toBe("há 8 min");
    expect(relTime(base, base + 3 * 3_600_000)).toBe("há 3h");
    expect(relTime(base, base + 2 * 86_400_000)).toBe("há 2d");
  });
  it("never goes negative", () => {
    expect(relTime(2000, 1000)).toBe("há 0s");
  });
});

describe("createPainter", () => {
  it("non-TTY: appends without cursor escapes", () => {
    let out = "";
    const p = createPainter({ tty: false, write: (s) => (out += s) });
    p.paint("frame-1");
    p.paint("frame-2");
    expect(out).toBe("frame-1\nframe-2\n");
    expect(out).not.toContain("\x1b[");
  });

  it("TTY: second paint moves the cursor up over the first frame", () => {
    const writes = [];
    const p = createPainter({ tty: true, write: (s) => writes.push(s) });
    p.paint("a\nb\nc"); // 3 lines + trailing \n = 4
    p.paint("x");
    const joined = writes.join("");
    expect(joined).toContain("\x1b[4A"); // up 4 lines before the second frame
    expect(joined).toContain("\x1b[0J"); // clear to end of screen
  });
});
