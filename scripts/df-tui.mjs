// df-tui — the live panel (grok-build style) for the `df` CLI. A single boxed
// frame (rounded corners, a divider before the command bar) that the CLI can
// repaint in place. The RENDER is pure: renderPanel(state) -> string. The PAINT
// (in-place cursor moves) is a thin, separate side-effecting layer so the render
// stays trivially testable.
//
// Brand palette (24-bit ANSI, no dep): sage dots, orange accent/URL/keys,
// green ✓, red ✗, dim secondary. Respects NO_COLOR and non-TTY (the painter
// degrades to plain append — no cursor moves, no escape soup in pipes/CI).
//
// Zero external deps — pure Node core.

const ESC = "\x1b[";

// Style factory. With color off, every style is the identity — so the same
// segment list renders clean in a pipe and pretty in a terminal.
export function makeStyles(color) {
  const c = (code) => (s) => (color ? `${ESC}${code}m${s}${ESC}0m` : s);
  return {
    sage: c("38;2;215;232;200"),
    orange: c("38;2;255;85;36"),
    green: c("38;2;45;169;82"),
    red: c("38;2;200;57;42"),
    dim: c("2"),
    bold: c("1"),
    plain: (s) => s,
  };
}

// Default inner width (chars between the side borders). The panel is fixed-width;
// rows are padded to it so the right border always lines up.
export const PANEL_WIDTH = 50;

const repeat = (ch, n) => ch.repeat(Math.max(0, n));

// ── box primitives — ANSI-aware padding ──────────────────────────────────────
// A "segment" is { text, style } where style is a key of makeStyles(). Padding
// is computed from the VISIBLE text length (segment.text, never the colorized
// output), so escape codes never throw the width off.

function visibleLen(segments) {
  return segments.reduce((n, s) => n + [...s.text].length, 0);
}

function colorize(segments, S) {
  return segments.map((s) => (S[s.style] || S.plain)(s.text)).join("");
}

function frameTop(S, w) {
  return S.dim("╭" + repeat("─", w) + "╮");
}
function frameBottom(S, w) {
  return S.dim("╰" + repeat("─", w) + "╯");
}
function frameDivider(S, w) {
  return S.dim("├" + repeat("─", w) + "┤");
}

// A content row: │ + colorized segments + right-pad to w + │
function row(segments, S, w) {
  const pad = repeat(" ", w - visibleLen(segments));
  return S.dim("│") + colorize(segments, S) + pad + S.dim("│");
}

// A split row: left segments flush-left, right segments flush-right.
function rowSplit(left, right, S, w) {
  const used = visibleLen(left) + visibleLen(right);
  const gap = repeat(" ", Math.max(1, w - used));
  return S.dim("│") + colorize(left, S) + gap + colorize(right, S) + S.dim("│");
}

const blank = (S, w) => row([], S, w);

const seg = (text, style) => ({ text, style: style || "plain" });
const M = "  "; // two-space left margin used inside the box

// Relative time, pt-BR, compact. `now` is injected for testability.
export function relTime(startedAt, now) {
  const ms = Math.max(0, now - startedAt);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

// ── state renderers ──────────────────────────────────────────────────────────

// boot / ready: header + steps + url + command bar.
//   state.steps: [{ status: 'ok'|'run'|'err', label, detail }]
function renderReady(state, S, w) {
  const lines = [frameTop(S, w)];
  lines.push(
    rowSplit(
      [seg(M), seg("DESIGN FACTORY", "bold")],
      [seg(`${state.mode || "prod"} · ${state.version || ""}`.trim(), "dim"), seg(M)],
      S,
      w,
    ),
  );
  lines.push(row([seg(M), seg(state.tagline || "local · byok · multimodelo", "dim")], S, w));
  lines.push(blank(S, w));
  for (const st of state.steps || []) {
    const icon =
      st.status === "ok"
        ? seg("✓", "green")
        : st.status === "err"
          ? seg("✗", "red")
          : seg("⟳", "orange");
    lines.push(
      row(
        [
          seg(M),
          icon,
          seg("  "),
          seg((st.label || "").padEnd(13), "sage"),
          seg(st.detail || "", "dim"),
        ],
        S,
        w,
      ),
    );
  }
  if (state.url) {
    lines.push(blank(S, w));
    lines.push(row([seg(M), seg("→  ", "orange"), seg(state.url, "sage")], S, w));
  }
  lines.push(blank(S, w));
  lines.push(frameDivider(S, w));
  lines.push(commandBar(state.keys || DEFAULT_KEYS, S, w));
  lines.push(frameBottom(S, w));
  return lines.join("\n");
}

const DEFAULT_KEYS = [
  ["o", "abrir"],
  ["r", "reiniciar"],
  ["d", "docs"],
  ["q", "sair"],
];

// A command bar row: "key label   key label …" (keys orange, labels dim).
function commandBar(keys, S, w) {
  const segs = [seg(M)];
  keys.forEach(([k, label], i) => {
    if (i > 0) segs.push(seg("   "));
    segs.push(seg(k, "orange"), seg(" " + label, "dim"));
  });
  return row(segs, S, w);
}

// conflict: another DF is already running (cross-clone). The auto-heal heart.
function renderConflict(state, S, w) {
  const lines = [frameTop(S, w)];
  lines.push(row([seg(M), seg("DESIGN FACTORY já está rodando", "bold")], S, w));
  lines.push(blank(S, w));
  lines.push(row([seg(M), seg("pasta   ", "dim"), seg(state.folder || "", "sage")], S, w));
  lines.push(
    row(
      [
        seg(M),
        seg("web     ", "dim"),
        seg(state.url || "", "sage"),
        seg("  · "),
        state.healthy ? seg("healthy", "green") : seg("sem resposta", "red"),
      ],
      S,
      w,
    ),
  );
  if (state.since) lines.push(row([seg(M), seg("desde   ", "dim"), seg(state.since, "dim")], S, w));
  lines.push(blank(S, w));
  lines.push(
    row(
      [seg(M), seg("a", "orange"), seg("  assumir aqui  (encerra a outra, sobe esta)", "dim")],
      S,
      w,
    ),
  );
  lines.push(row([seg(M), seg("o", "orange"), seg("  abrir a que já está rodando", "dim")], S, w));
  lines.push(
    row([seg(M), seg("s", "orange"), seg("  subir do lado  (portas novas)", "dim")], S, w),
  );
  lines.push(frameDivider(S, w));
  lines.push(
    row(
      [
        seg(M),
        seg("escolha uma tecla", "dim"),
        seg("   ·   "),
        seg("q", "orange"),
        seg(" cancelar", "dim"),
      ],
      S,
      w,
    ),
  );
  lines.push(frameBottom(S, w));
  return lines.join("\n");
}

// status / doctor: the global registry, one row per instance.
//   state.instances: [{ folder, url, healthy, since }]
function renderStatus(state, S, w) {
  const lines = [frameTop(S, w)];
  lines.push(row([seg(M), seg("DESIGN FACTORY · instâncias", "bold")], S, w));
  lines.push(blank(S, w));
  const list = state.instances || [];
  if (list.length === 0) {
    lines.push(row([seg(M), seg("nenhuma instância rodando", "dim")], S, w));
  } else {
    for (const it of list) {
      const dot = it.healthy ? seg("●", "green") : seg("●", "red");
      lines.push(
        row(
          [
            seg(M),
            dot,
            seg("  "),
            seg(it.folder || "", "sage"),
            seg("  "),
            seg(it.url || "", "dim"),
            seg(it.since ? "  " + it.since : "", "dim"),
          ],
          S,
          w,
        ),
      );
    }
  }
  lines.push(frameDivider(S, w));
  lines.push(
    commandBar(
      state.keys || [
        ["s", "parar"],
        ["d", "doctor"],
        ["q", "sair"],
      ],
      S,
      w,
    ),
  );
  lines.push(frameBottom(S, w));
  return lines.join("\n");
}

// error: a red header + message lines.
function renderError(state, S, w) {
  const lines = [frameTop(S, w)];
  lines.push(row([seg(M), seg("✗", "red"), seg("  "), seg(state.title || "erro", "bold")], S, w));
  lines.push(blank(S, w));
  for (const msg of state.lines || [String(state.message || "")]) {
    lines.push(row([seg(M), seg(msg, "dim")], S, w));
  }
  lines.push(frameBottom(S, w));
  return lines.join("\n");
}

// Public: render a state to a string. PURE.
export function renderPanel(state, { color = false, width = PANEL_WIDTH } = {}) {
  const S = makeStyles(color);
  switch (state && state.kind) {
    case "conflict":
      return renderConflict(state, S, width);
    case "status":
      return renderStatus(state, S, width);
    case "error":
      return renderError(state, S, width);
    case "boot":
    case "ready":
    default:
      return renderReady(state || { kind: "ready" }, S, width);
  }
}

// ── painter — repaint in place (TTY) or append (non-TTY) ──────────────────────
export function createPainter({ tty = false, write = (s) => process.stdout.write(s) } = {}) {
  let lastLineCount = 0;
  return {
    paint(panelStr) {
      if (tty && lastLineCount > 0) {
        write(`${ESC}${lastLineCount}A`); // cursor up N lines
        write(`${ESC}0J`); // clear from cursor to end of screen
      }
      write(panelStr + "\n");
      lastLineCount = panelStr.split("\n").length + 1; // +1 for the trailing \n
    },
    reset() {
      lastLineCount = 0;
    },
  };
}

// Strip ANSI — handy for callers (and tests) measuring visible width.
export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
