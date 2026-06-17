/**
 * schemas.ts — Boundary validation for everything that crosses the
 * filesystem / bridge / db barriers.
 *
 * Zod schemas describe the shape we EXPECT. `safeRead` returns null
 * when input fails validation (so callers don't need to special-case);
 * `safeWriteOrThrow` throws when the input we're about to send out is
 * malformed (catches our own bugs early).
 *
 * Any data shape that crosses a boundary should have a schema here.
 * If it's only ephemeral in-memory state, it belongs in component
 * useState — not in this file.
 */

import { z } from "zod";

// ─── Primitives ───────────────────────────────────────────────────────

// Number coerced from string when needed (e.g., "1234" → 1234). Some
// older meta files stored timestamps as strings.
const FlexibleNumber = z.preprocess(
  (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v),
  z.number(),
);
const FlexibleString = z.string();

// ─── Provider identity ───────────────────────────────────────────────
//
// Single source of truth for which provider ids the runtime accepts.
// Mirrors src/providers/types.ts ProviderId union — keep in sync.
// V1 beta roster (10 entries): CLIs (claude/codex/gemini/opencode) +
// APIs (kimi/anthropic/openai/gemini-api/openrouter) + local (ollama).
export const ProviderIdSchema = z.enum([
  "claude",
  "codex",
  "gemini",
  "opencode",
  "kimi",
  "anthropic",
  "openai",
  "gemini-api",
  "openrouter",
  "ollama",
]);
export type ProviderIdValue = z.infer<typeof ProviderIdSchema>;

// ─── Chat (Turn JSONL on disk) ────────────────────────────────────────

// Attachments render as a separate chip row in the chat instead of
// being prepended as raw markdown to message.text. The agent still
// receives the file content/reference inline in the prompt sent to
// the provider (since CLIs only accept a single prompt string), but
// the chat history persists name/size/path metadata so the UI can
// render a clean chip row alongside the user prose.
//
// Fields are all optional/loose so legacy turns without `attachments`
// keep parsing — backward-compatible with older chat history on disk.
export const ChatAttachmentSchema = z.object({
  /** Original filename (sanitized for display only — not used as path). */
  name: z.string().min(1),
  /** Bytes — used to render the size chip (e.g. "5kb"). */
  size: z.number().nonnegative(),
  /** Mime type as reported by the browser at attach time. */
  mime: z.string().default("application/octet-stream"),
  /** Discriminator. "image" attachments live on disk via .df-attachments/;
   *  the rest are inlined in the agent prompt (text) or referenced via
   *  data URL (binary fallback). */
  kind: z.enum(["image", "text", "html", "binary"]).default("binary"),
  /** Absolute on-disk path for image attachments — Claude reads via its
   *  Read tool. Undefined for inline text/binary. */
  path: z.string().optional(),
  /** Inline content for text/html attachments (kept small — under 500kb).
   *  Omitted on disk for image attachments to keep JSONL light. */
  content: z.string().optional(),
  /** Transient data-URL thumbnail for the composer preview only. NOT
   *  persisted (the composer sets it; the persisted-message builder omits
   *  it) so chat JSONL stays light. */
  preview: z.string().optional(),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const TurnUserSchema = z.object({
  text: z.string().default(""),
  /** files attached to this turn, rendered as chips beside the prose.
   *  Legacy turns omit this — the schema stays optional so old JSONL keeps
   *  parsing without migration. */
  attachments: z.array(ChatAttachmentSchema).optional(),
  verb: z
    .object({
      id: z.string(),
      label: z.string(),
      category: z.enum(["evaluate", "refine", "direction", "enhance", "fix", "export"]).optional(),
      modifiesHtml: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

export const TurnAiSchema = z.object({
  text: z.string().default(""),
  tools: z.array(z.unknown()).optional(),
  // : canonical tool events (provider-tagged). Loose schema —
  // accept any object so older turns without the field still parse.
  // Backfilled at read-time by migrateLegacyToolEvents from the legacy
  // `tools` ledger.
  toolEvents: z.array(z.unknown()).optional(),
  is_design: z.boolean().optional(),
  // AiStatus parity with src/lib/chat-turns.ts (`AiStatus` TS type).
  // Pre-2026-05-08 the enum here was ["done","error","incomplete"] while
  // chat-turns shipped ["running","done","error","cancelled"] — turns
  // emitted by turn-pipeline with `cancelled` (src/runtime/turn-pipeline.ts)
  // were silently rejected by safeWriteOrThrow at appendChatTurn time.
  // The new union covers the full lifecycle the audit Fase 1 + the
  // upcoming stream-lifecycle audit will produce. `incomplete` was a
  // dead value (no caller ever wrote it) and is dropped.
  status: z.enum(["running", "done", "error", "cancelled", "interrupted"]).optional(),
  duration_ms: z.number().optional(),
  error: z.string().optional(),
  html_snapshot_id: z.string().optional(),
  // Provider Handoff Layer v1: which model spoke this turn. Optional so
  // pre-v1 turns on disk still parse — `undefined` falls back to "claude"
  // when the UI needs to render a badge for legacy data.
  provider: ProviderIdSchema.optional(),
  model: z.string().optional(),
  // F1.1 — Per-message stats so the footer below each assistant bubble
  // can render provider · model · duration · tokens · cost permanently
  // (survives reload). Sourced from StreamResult at finalize time. All
  // optional; legacy turns without them just hide the footer.
  tokens_in: z.number().optional(),
  tokens_out: z.number().optional(),
  cost_usd: z.number().optional(),
  ttft_ms: z.number().optional(),
});

export const TurnSchema = z.object({
  id: z.string().min(1),
  ts: FlexibleNumber.optional(),
  user: TurnUserSchema,
  ai: TurnAiSchema.nullable().optional(),
});

export type ParsedTurn = z.infer<typeof TurnSchema>;

export const ChatReadTurnsResponseSchema = z.object({
  turns: z.array(TurnSchema),
  migrated: z.boolean().optional(),
});

// Cached message snapshot (db.setSetting `tmsg:${projectId}:${threadId}`)
//
// Schema migrated 2026-05-03 (Provider Handoff Layer v0):
//   - role: "user" | "claude" → "user" | "assistant"
//   - +provider (which model spoke) +model (specific model id)
// Schema extended 2026-05-04 (— tool event normalization):
//   - +toolEvents (canonical NormalizedToolEvent[] tagged with provider)
//
// Legacy cache entries with `role: "claude"` are migrated transparently via
// migrateLegacyChatMessage() in src/lib/migrations.ts when we read from disk.
// Legacy entries WITHOUT `toolEvents` get backfilled by
// migrateLegacyToolEvents() at the same read-time entry point.
export const CachedMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  provider: ProviderIdSchema.optional(),
  model: z.string().optional(),
  text: z.string().default(""),
  ts: FlexibleNumber.optional(),
  turn_id: z.string().optional(),
  isDesign: z.boolean().optional(),
  streaming: z.boolean().optional(),
  version_id: z.string().optional(),
  // tools/verb/toolEvents shapes are looser — accept any object so old
  // caches don't fail validation.
  tools: z.array(z.unknown()).optional(),
  toolEvents: z.array(z.unknown()).optional(),
  verb: z.unknown().optional(),
  // attachments rendered as chip row below user prose. Optional so
  // legacy snapshots without the field continue to parse.
  attachments: z.array(ChatAttachmentSchema).optional(),
  // F1.1 — Per-message stats mirror of TurnAiSchema fields. Cached
  // snapshot persists these so reload renders the footer immediately
  // (before chat.jsonl finishes hydrating in the background).
  duration_ms: z.number().optional(),
  tokens_in: z.number().optional(),
  tokens_out: z.number().optional(),
  cost_usd: z.number().optional(),
  ttft_ms: z.number().optional(),
});
export const CachedMessagesArraySchema = z.array(CachedMessageSchema);
export type ParsedCachedMessage = z.infer<typeof CachedMessageSchema>;

// ─── Project meta (.df/meta.json) ──────────────────────────────────

export const ProjectMetaSchema = z.object({
  id: z.string().min(1),
  name: FlexibleString,
  mode: z.enum(["wireframe", "hifi"]),
  created_at: FlexibleNumber,
  updated_at: FlexibleNumber,
  ds_path: z.string().optional(),
  ds_name: z.string().optional(),
  start_mode: z.enum(["prototype", "slide", "template", "other"]).optional(),
  initial_user_prompt: z.string().optional(),
  initial_raw_prompt: z.string().optional(),
  initial_direction_selection: z
    .object({
      formatoId: z.string(),
      directionIds: z.array(z.string()),
      customAntiSlop: z.array(z.string()),
      removedAntiSlop: z.array(z.string()).optional(),
      enabledAntiSlop: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  video_ratio: z.enum(["16:9", "9:16", "1:1", "4k"]).optional(),
});
export type ParsedProjectMeta = z.infer<typeof ProjectMetaSchema>;

// ─── Global config (~/.design-factory/config.json) ────────────────

export const GlobalConfigSchema = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  /** UI language preference. Covers the New Project modal and
   *  Settings; the rest of the app migrates progressively. Defaults
   *  to pt-BR when unset. */
  language: z.enum(["pt", "en", "xx"]).optional(),
  default_provider: ProviderIdSchema.optional(),
  model: z.string().optional(),
  skills_custom_path: z.string().optional(),
  builtin_prompts: z.record(z.string(), z.string()).optional(),
  accent_color: z.string().optional(),
  format_overrides: z
    .record(
      z.string(),
      z.object({
        nome: z.string().optional(),
        descricao: z.string().optional(),
        prompt_prefix: z.string().optional(),
        anti_slop: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  direction_overrides: z
    .record(
      z.string(),
      z.object({
        nome: z.string().optional(),
        descricao: z.string().optional(),
        prompt_addon: z.string().optional(),
      }),
    )
    .optional(),
  custom_formats: z.array(z.unknown()).optional(),
  custom_directions: z.array(z.unknown()).optional(),
  // split: canvas / format-taxonomy / direction-taxonomy
  // are independent stores from the legacy direction-data.ts catalog.
  custom_canvas_presets: z.array(z.unknown()).optional(),
  custom_format_categories: z.array(z.unknown()).optional(),
  custom_direction_categories: z.array(z.unknown()).optional(),
  // Unified rules catalog — replaces the direction taxonomy at the
  // picker layer. Stored as a flat list of user-authored rules plus
  // an override map for builtins. Validation is loose here
  // (Zod unknown[]); rules-taxonomy.ts owns the strict shape.
  custom_rules: z.array(z.unknown()).optional(),
  builtin_rule_overrides: z.record(z.string(), z.unknown()).optional(),
  // Padrões category management.
  custom_rule_categories: z.array(z.unknown()).optional(),
  rule_category_overrides: z.record(z.string(), z.string()).optional(),
  // Permanent hide of builtin items / categories. Distinct from
  // `disabled_*` (soft hide that keeps the row visible in Padrões);
  // `hidden_*` items disappear from the list entirely until "Resetar
  // tudo aos padrões" is invoked.
  hidden_builtin_canvas_presets: z.array(z.string()).optional(),
  hidden_builtin_format_items: z.array(z.string()).optional(),
  hidden_builtin_format_categories: z.array(z.string()).optional(),
  hidden_builtin_rules: z.array(z.string()).optional(),
  hidden_builtin_rule_categories: z.array(z.string()).optional(),
  hidden_builtin_commands: z.array(z.string()).optional(),
});
export type ParsedGlobalConfig = z.infer<typeof GlobalConfigSchema>;

// ─── Provider sessions (.df/provider-sessions.json) ──────────────
//
// One entry per provider used in this project. `sessionId` is the CLI's
// native resume token (`claude --resume <id>`, `codex resume <id>`, etc.).
// `null` means the provider was used but doesn't support resume — every
// turn is a fresh inject. `artifact_version_seen` lets the handoff
// builder skip resending L3 when the artifact hasn't moved.
//
// Provider Handoff Layer v1, spec §4.3 (legacy v1 entry shape).
export const ProviderSessionEntrySchema = z.object({
  sessionId: z.string().nullable(),
  created_at: FlexibleNumber,
  last_used_at: FlexibleNumber,
  artifact_version_seen: z.number().int().nonnegative().default(0),
});
export type ProviderSessionEntry = z.infer<typeof ProviderSessionEntrySchema>;

// Note: `z.record(enum, ...)` infers a fully-required Record. We want a
// sparse map (one entry per provider that has been used), so the runtime
// schema accepts string keys (validated at the upsert layer) and the
// public type narrows them via Partial<Record<ProviderId, ...>>.
const ProviderSessionsRuntimeSchema = z.object({
  version: z.literal(1),
  sessions: z.record(z.string(), ProviderSessionEntrySchema).default({}),
});
export const ProviderSessionsSchema = ProviderSessionsRuntimeSchema.transform((v) => {
  // Drop unknown provider keys silently — schema drift insurance.
  const allowed = ProviderIdSchema.options as readonly string[];
  const sessions: Partial<Record<ProviderIdValue, ProviderSessionEntry>> = {};
  for (const [k, val] of Object.entries(v.sessions)) {
    if (allowed.includes(k)) sessions[k as ProviderIdValue] = val;
  }
  return { version: v.version, sessions };
});
export type ProviderSessions = {
  version: 1;
  sessions: Partial<Record<ProviderIdValue, ProviderSessionEntry>>;
};

// ─── Provider sessions v3 (REMOVED) ─────────────────────────
//
// The v3 multi-file aware canonical session state was part of the
// Provider Handoff Layer that removed. The v1 shape above is the
// only one reads/writes. Older session files have
// orphan `${provider}:${slug}:${thread}` keys at the top level — they
// are silently ignored and cleaned up on the next v1 write.

// ─── Artifact state (.df/artifact-state.json) ────────────────────
//
// Tracks which file the providers are editing + a monotonic version
// counter. The counter bumps every time the user (or any provider) saves
// the artifact, so other providers know to refresh L3 on their next turn.
//
// Provider Handoff Layer v1, spec §4.3.
export const ArtifactStateSchema = z.object({
  version: z.literal(1),
  primary_path: z.string(),
  secondary_paths: z.array(z.string()).default([]),
  snapshot_version: z.number().int().nonnegative().default(1),
  last_modified: FlexibleNumber,
  byte_size: z.number().int().nonnegative().default(0),
});
export type ArtifactState = z.infer<typeof ArtifactStateSchema>;

// ─── Direction selection (per project) ────────────────────────────

export const DirectionSelectionSchema = z.object({
  formatoId: z.string().min(1),
  directionIds: z.array(z.string()),
  enabledAntiSlop: z.array(z.string()).default([]),
  customAntiSlop: z.array(z.string()).default([]),
  removedAntiSlop: z.array(z.string()).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Parse `input` against `schema`. On failure, log the issues with the
 * provided `context` label and return null. Use this on every read from
 * a boundary (bridge, db, fs).
 *
 *   const parsed = safeRead(GlobalConfigSchema, raw, "readGlobalConfig");
 *   if (!parsed) return null;
 */
export function safeRead<T>(schema: z.ZodType<T>, input: unknown, context: string): T | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  // Don't blow up the app — but DO log so the bug surfaces in console
  // and (eventually) telemetry. Each failure is a real schema drift.
  console.warn(
    `[schema] ${context} failed validation:`,
    result.error.issues.slice(0, 5),
    "\nraw input:",
    truncateForLog(input),
  );
  return null;
}

/**
 * Validate `input` against `schema` BEFORE writing it out. Throws on
 * failure — this catches OUR bugs (we're about to persist garbage).
 * Use on every write/append.
 */
export function safeWriteOrThrow<T>(schema: z.ZodType<T>, input: unknown, context: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const msg = `[schema] ${context} would write invalid data: ${result.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ")}`;
  console.error(msg, "\nraw:", truncateForLog(input));
  throw new Error(msg);
}

function truncateForLog(v: unknown, max = 500): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}…(${s.length - max} more)` : s;
  } catch {
    return String(v);
  }
}
