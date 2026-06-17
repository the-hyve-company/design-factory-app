#!/usr/bin/env node
// i18n-audit.mjs — Detect hardcoded UI strings in src/.
//
// Walks src/ recursively, parses .tsx/.ts via Babel, finds string literals
// that look like user-facing text:
//   · JSX text children: <button>Save</button>
//   · JSX attributes that surface to the UI: aria-label, title, placeholder,
//     alt, aria-description, aria-placeholder, label, value (limited).
//   · CallExpressions producing UI: showToast("..."), window.alert/confirm/prompt.
//
// Filters obvious noise (single chars, punctuation-only, urls, identifiers).
// Honors a baseline whitelist in docs/i18n-baseline.txt:
//   · Each line: "src/path/to/file.tsx:LINE  message"
//   · Lines with leading "#" are comments.
// Offenders that exactly match a baseline entry are tagged WHITELISTED.
//
// Usage:
//   node scripts/i18n-audit.mjs           # text output
//   node scripts/i18n-audit.mjs --json    # JSON
//   node scripts/i18n-audit.mjs --md      # markdown report
//   node scripts/i18n-audit.mjs --baseline # write current findings to docs/i18n-baseline.txt
//
// Exit code: 0 if zero offenders OR all offenders are whitelisted, 1 otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";

// `@babel/traverse` ships as both ESM/CJS depending on version; default may be the namespace
const traverse = typeof _traverse === "function" ? _traverse : _traverse.default;

// ─── Config ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const BASELINE_FILE = path.join(ROOT, "docs", "i18n-baseline.txt");

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage"]);

// Files / paths we don't audit (canonical labels live here, generated maps,
// tests, lab routes that are intentionally bilingual or English-by-design).
const SKIP_FILE_PATTERNS = [
  /\/i18n\//, // i18n tables themselves
  /\/data\//, // canonical data labels (have i18n bridge)
  /\.test\.(tsx?|jsx?)$/, // tests
  /\.spec\.(tsx?|jsx?)$/, // specs
  // Lab/dev surfaces — intentionally scratch-pad, not user-facing.
  /\/screens\/lab\//,
  /\/components\/lab\//, // modal-lab redesign directions (?modalLab=1)
  /NPCanvasShell|NPCanonicalPlus|NPPromptFirst|NPSplit/,
  /Lab\.tsx$/, // *Lab.tsx scratch pads
  /NewProjectLabScreen\.tsx$/,
  /NewProjectRegionsLabScreen\.tsx$/,
  /NewProject(?:CanonicalPlus|Conv|Mood|PromptFirst|Spatial|Verb)Lab\.tsx$/,
  /NewProjectLabsHub\.tsx$/,
  /\/screens\/DevScreen\.tsx$/, // /dev internal scratchpad
  /\/screens\/ShowcaseScreen\.tsx$/, // showcase route — DS demo
  /\/screens\/ShadersScreen\.tsx$/, // shaders route — DS demo
  /\/__tests__\//, // mocha-style tests
  /\.d\.ts$/, // type defs
];

// JSX attributes that surface user-facing text.
const UI_ATTRS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "alt",
  "title",
  "placeholder",
  "label",
  "summary",
  "longdesc",
]);

// Functions that produce UI when called with a string literal.
// Only the FIRST argument is audited.
const UI_CALLS = new Set([
  "showToast",
  "showError",
  "showSuccess",
  "showInfo",
  "showWarning",
  "alert",
  "confirm",
  "prompt",
  "toast",
  "notify",
]);

// ─── Heuristics for "is this text user-facing?" ────────────────────────

function isLikelyText(s) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (trimmed.length < 2) return false;

  // No letters at all → definitely not natural language.
  if (!/[A-Za-zÀ-ÿ]/.test(trimmed)) return false;

  // URL or path → skip.
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^(\/|\.\.?\/|\.\/)/.test(trimmed)) return false;
  // Home-relative or env-relative paths.
  if (/^~\/[\w./-]+$/.test(trimmed)) return false;
  if (/^\$[A-Z][A-Z0-9_]*$/.test(trimmed)) return false;

  // CSS values, hex colors, transforms, etc.
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return false;
  if (/^(rgb|rgba|oklch|hsl|hsla|var|calc|url)\s*\(/i.test(trimmed)) return false;
  if (/^[\d.]+(px|rem|em|%|vh|vw|s|ms|deg|fr)$/i.test(trimmed)) return false;
  if (/^[\d.]+\s+[\d.]+/.test(trimmed) && !/[a-zA-ZÀ-ÿ]\s/.test(trimmed)) return false;

  // HTML/XML/JSON/JS markup-looking placeholders → skip. These are code,
  // not natural language. Common in code-pasting textareas.
  if (/^\s*<!?[A-Za-z][^>]*>/.test(trimmed)) return false;
  if (/^\s*[<{[]/.test(trimmed) && /[>}\]]/.test(trimmed)) {
    // Has structural punctuation across the string → likely markup/JSON.
    if (/<\/?\w|<\w+\s|<!DOCTYPE|<\?xml|^\{[\s"]/.test(trimmed)) return false;
  }

  // Single dotted identifier or ALL_CAPS slug → likely a key/enum, not text.
  if (/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(trimmed)) return false; // foo.bar.baz keys
  if (/^[A-Z][A-Z0-9_]+$/.test(trimmed) && trimmed.length < 30) return false; // SCREAMING

  // CamelCase identifier (no spaces) → likely a className, role, etc.
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed) && !/\s/.test(trimmed) && trimmed.length < 14) {
    // Allow short single words that are user-visible: "Save", "Cancel"…
    // Heuristic: starts with uppercase AND length >= 3 → keep as candidate.
    if (!/^[A-Z][a-z]+$/.test(trimmed)) return false;
  }

  // Class-y strings (common Tailwind patterns).
  if (
    /(^|\s)(flex|grid|absolute|relative|text-|bg-|border-|rounded-|px-|py-|gap-|w-|h-)/.test(
      trimmed,
    )
  ) {
    if (trimmed.split(/\s+/).every((tok) => /^[a-z][a-z0-9-]*[:/]?[a-z0-9-]*$/i.test(tok))) {
      return false;
    }
  }

  // Date / number patterns
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(trimmed)) return false;

  // Has at least one whitespace or 3+ letters → real text.
  if (/\s/.test(trimmed)) return true;
  if (/[A-Za-zÀ-ÿ]{3,}/.test(trimmed)) return true;

  return false;
}

// ─── File walk ─────────────────────────────────────────────────────────

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name)) {
      yield full;
    }
  }
}

function shouldSkipFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  return SKIP_FILE_PATTERNS.some((pat) => pat.test(rel));
}

// ─── Parser ────────────────────────────────────────────────────────────

function parseFile(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  return parser.parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "topLevelAwait"],
    errorRecovery: true,
  });
}

function getCallName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

function auditFile(filePath, offenders) {
  let ast;
  try {
    ast = parseFile(filePath);
  } catch (err) {
    // Skip unparseable files but report.
    offenders.errors.push({ file: filePath, error: err.message });
    return;
  }

  traverse(ast, {
    JSXText(p) {
      const raw = p.node.value;
      // Collapse internal whitespace, strip leading/trailing.
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) return;
      if (!isLikelyText(text)) return;
      offenders.list.push({
        file: filePath,
        line: p.node.loc?.start?.line ?? 0,
        col: p.node.loc?.start?.column ?? 0,
        kind: "JSXText",
        text,
      });
    },

    JSXAttribute(p) {
      const name = p.node.name?.name;
      if (typeof name !== "string") return;
      if (!UI_ATTRS.has(name)) return;
      const v = p.node.value;
      if (!v) return;
      if (v.type === "StringLiteral") {
        if (!isLikelyText(v.value)) return;
        offenders.list.push({
          file: filePath,
          line: v.loc?.start?.line ?? 0,
          col: v.loc?.start?.column ?? 0,
          kind: `attr:${name}`,
          text: v.value,
        });
      } else if (v.type === "JSXExpressionContainer" && v.expression?.type === "StringLiteral") {
        if (!isLikelyText(v.expression.value)) return;
        offenders.list.push({
          file: filePath,
          line: v.expression.loc?.start?.line ?? 0,
          col: v.expression.loc?.start?.column ?? 0,
          kind: `attr:${name}`,
          text: v.expression.value,
        });
      }
    },

    CallExpression(p) {
      const name = getCallName(p.node.callee);
      if (!name || !UI_CALLS.has(name)) return;
      const arg = p.node.arguments?.[0];
      if (!arg) return;
      if (arg.type === "StringLiteral") {
        if (!isLikelyText(arg.value)) return;
        offenders.list.push({
          file: filePath,
          line: arg.loc?.start?.line ?? 0,
          col: arg.loc?.start?.column ?? 0,
          kind: `call:${name}`,
          text: arg.value,
        });
      } else if (arg.type === "TemplateLiteral" && arg.quasis.length === 1) {
        // Template literal with no interpolation = string literal.
        const text = arg.quasis[0].value.cooked || arg.quasis[0].value.raw;
        if (!isLikelyText(text)) return;
        offenders.list.push({
          file: filePath,
          line: arg.loc?.start?.line ?? 0,
          col: arg.loc?.start?.column ?? 0,
          kind: `call:${name}`,
          text,
        });
      }
    },
  });
}

// ─── Baseline ──────────────────────────────────────────────────────────

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return new Set();
  const raw = fs.readFileSync(BASELINE_FILE, "utf8");
  const set = new Set();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    set.add(trimmed);
  }
  return set;
}

function offenderKey(o) {
  // Key by file + exact text only — NOT line number. A line-numbered key
  // breaks the whole baseline whenever an edit shifts lines (every offender
  // below the edit looks "new"), which fails CI on unrelated changes. Text +
  // file is stable across refactors and is what we actually want to whitelist.
  const rel = path.relative(ROOT, o.file);
  return `${rel}\t${o.text}`;
}

function writeBaseline(offenders) {
  const dir = path.dirname(BASELINE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = [
    "# i18n-audit baseline — entries here are accepted as known offenders.",
    "# Format: <relative-path>\\t<exact text>  (line-independent — survives edits)",
    "# Generated: " + new Date().toISOString(),
    "",
  ];
  for (const o of offenders.list) lines.push(offenderKey(o));
  fs.writeFileSync(BASELINE_FILE, lines.join("\n") + "\n", "utf8");
}

// ─── Reporters ─────────────────────────────────────────────────────────

function reportText(offenders, baseline) {
  const lines = [];
  let kept = 0,
    whitelisted = 0;
  for (const o of offenders.list) {
    const rel = path.relative(ROOT, o.file);
    const key = offenderKey(o);
    if (baseline.has(key)) {
      whitelisted++;
      continue;
    }
    kept++;
    lines.push(`${rel}:${o.line}:${o.col}  [${o.kind}]  ${JSON.stringify(o.text)}`);
  }
  lines.sort();
  lines.unshift(`# i18n-audit — ${kept} offenders (excluding ${whitelisted} whitelisted)\n`);
  if (offenders.errors.length) {
    lines.push("\n# Parse errors:");
    for (const e of offenders.errors) {
      lines.push(`  ${path.relative(ROOT, e.file)}: ${e.error}`);
    }
  }
  return { text: lines.join("\n"), kept, whitelisted };
}

function reportJson(offenders, baseline) {
  const live = [];
  const wl = [];
  for (const o of offenders.list) {
    const rel = path.relative(ROOT, o.file);
    const item = { ...o, file: rel };
    if (baseline.has(offenderKey(o))) wl.push(item);
    else live.push(item);
  }
  return JSON.stringify(
    { totalScanned: offenders.scanned, offenders: live, whitelisted: wl, errors: offenders.errors },
    null,
    2,
  );
}

function reportMd(offenders, baseline) {
  const live = [];
  const wl = [];
  for (const o of offenders.list) {
    const rel = path.relative(ROOT, o.file);
    if (baseline.has(offenderKey(o))) wl.push({ ...o, rel });
    else live.push({ ...o, rel });
  }
  const byFile = new Map();
  for (const o of live) {
    if (!byFile.has(o.rel)) byFile.set(o.rel, []);
    byFile.get(o.rel).push(o);
  }
  const out = [];
  out.push("# i18n Audit Report");
  out.push("");
  out.push(`- Files scanned: **${offenders.scanned}**`);
  out.push(`- Offenders: **${live.length}**`);
  out.push(`- Whitelisted: **${wl.length}**`);
  out.push(`- Parse errors: **${offenders.errors.length}**`);
  out.push("");
  if (live.length === 0) {
    out.push("No live offenders. ✅");
  } else {
    out.push("## Offenders by file");
    out.push("");
    const files = [...byFile.keys()].sort();
    for (const f of files) {
      const items = byFile.get(f).sort((a, b) => a.line - b.line);
      out.push(`### \`${f}\` (${items.length})`);
      out.push("");
      for (const it of items) {
        out.push(`- L${it.line} \`[${it.kind}]\` — ${JSON.stringify(it.text)}`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = new Set(process.argv.slice(2));
  const wantJson = args.has("--json");
  const wantMd = args.has("--md");
  const writeBaselineFlag = args.has("--baseline");

  const offenders = { list: [], errors: [], scanned: 0 };
  for (const f of walk(SRC)) {
    if (shouldSkipFile(f)) continue;
    offenders.scanned++;
    auditFile(f, offenders);
  }

  if (writeBaselineFlag) {
    writeBaseline(offenders);
    process.stdout.write(
      `# Wrote ${offenders.list.length} entries to ${path.relative(ROOT, BASELINE_FILE)}\n`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline();

  if (wantJson) {
    process.stdout.write(reportJson(offenders, baseline) + "\n");
  } else if (wantMd) {
    process.stdout.write(reportMd(offenders, baseline) + "\n");
  } else {
    const r = reportText(offenders, baseline);
    process.stdout.write(r.text + "\n");
    process.stdout.write(`\n# Summary: ${r.kept} live offenders, ${r.whitelisted} whitelisted\n`);
  }

  // Exit code: 1 if there are non-whitelisted offenders.
  let live = 0;
  for (const o of offenders.list) {
    if (!baseline.has(offenderKey(o))) live++;
  }
  process.exit(live === 0 ? 0 : 1);
}

main();
