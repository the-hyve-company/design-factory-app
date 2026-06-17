# DesignFactory — Universal agent contract

> Source of truth for **any** AI agent (Claude Code, Codex, Gemini, Cursor,
> Aider, Copilot, OpenRouter models, Ollama, ...) that the user invokes
> from inside DesignFactory to build or refine an HTML project.
>
> This file is intentionally provider-agnostic. Provider-specific adapters
> (`.claude/CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) point here as canonical
> and add only what's specific to their harness.

DesignFactory (DF) is a local-first web app where the user chats with you and
sees an iframe render the result live. They type a prompt, you produce a
file, the iframe refreshes from disk. The user never sees your tool calls
or your reasoning — they only see the rendered file and the chat reply.

This contract defines the rules so every provider behaves the same.

---

## 1. Project workspace

Every DF project lives in one folder under the repo's `projects/` root:

```
projects/{slug}/
├── {slug}.html       ← the entry file the iframe renders (PRIMARY_FILE)
├── tab-1-foo.html    ← optional secondary tabs (tab-N-name.html)
├── assets/           ← images, fonts, anything the HTML imports
└── .df/              ← app-managed metadata. DO NOT TOUCH except via
    ├── meta.json     ←   the "save a version" mechanism described below.
    ├── chat/{threadId}.jsonl
    └── versions/{vid}.json
```

The session preamble injected into your prompt always provides:

- `PROJECT_PATH` — absolute path to `projects/{slug}/`
- `PRIMARY_FILE` — absolute path to `{slug}.html`

Use absolute paths in every Write/Edit. Relative paths land in the
working directory (the DF repo root), not the user's project.

### Files YOU touch

Only the files inside `projects/{slug}/` outside `.df/`:

| File             | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `{slug}.html`    | The primary file. The iframe ALWAYS renders this.      |
| `tab-N-foo.html` | Secondary tab views (only when the user asks for them) |
| `assets/*`       | Images, audio, fonts, any binary the HTML imports      |

### Files you NEVER touch

- `.df/meta.json` — owned by the app
- `.df/chat/*.jsonl` — owned by the app (per-thread chat logs)
- `.df/versions/*` — versioning is exposed via the app's "Save version"
  control. If the user says "save this as a version", emit a chat reply
  describing the snapshot — the app will trigger the save.
- Anything outside `projects/{slug}/`

---

## 2. Output contract

Two outputs per turn — and they are NEVER mixed:

| Channel                                               | Goes there                           | Why                                   |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| **The file** (Write/Edit tool, or `<artifact>` block) | Code only — HTML/CSS/JS that renders | The iframe shows the file as-is       |
| **The chat reply** (your prose)                       | 1-3 lines of plain natural language  | The user reads this beside the iframe |

### Output channel by capability

The runtime picks the output channel from the active provider's
`capabilities.fileWrite` field. There are exactly two values; you do not
need to detect this yourself — the agent harness (CLAUDE.md / GEMINI.md /
AGENTS.md) tells you which channel applies for the current provider.

**Providers with `capabilities.fileWrite === "tool"`**

Claude Code, Codex CLI, Opencode, Kimi Code CLI — any provider whose
adapter wires native Write/Edit (or its equivalent) tools to the
harness.

- Call `Write {PRIMARY_FILE}` (or `Edit` for surgical changes) with the
  full file content as a tool argument.
- The runtime persists the bytes; the iframe reloads automatically.
- Chat reply is 1-3 lines of prose that DO NOT repeat the file contents.

**Providers with `capabilities.fileWrite === "artifact"`**

Gemini CLI, Anthropic API (BYOK), OpenAI API, Gemini API, OpenRouter
API, Ollama — any adapter that surfaces text only.

- Embed the file in your response as a single `<artifact>` block.
  The block MUST carry three attributes — `identifier`, `type`, and
  `title` — in that order. The parser rejects blocks missing
  `identifier` or `type` as `invalid-attributes`.

  ```
  <artifact identifier="projects/{slug}/{slug}.html" type="text/html" title="Mobile halftone lab">
  <!DOCTYPE html>
  <html>...</html>
  </artifact>
  ```

  Attribute contract (enforced by `src/runtime/artifact-processor.ts`):
  - `identifier` (REQUIRED) — the path the file should land at,
    relative to the repo root (so `projects/{slug}/{slug}.html`,
    NOT `/{absolute}/...` and NOT just `{slug}.html`).
  - `type` (REQUIRED) — MIME type. `text/html` for the primary file.
    Other accepted: `text/css`, `application/javascript`,
    `application/json`, `image/svg+xml`, `text/markdown`.
  - `title` (RECOMMENDED) — short human label shown in chat history.
    Missing title degrades gracefully; missing identifier or type
    rejects the block.

- The runtime parses this block and materializes the bytes on disk
  via the daemon's artifact-writer — the user never sees the
  raw block in chat. This is enforced by chat-sanitizer (see §6).
- Chat reply (the prose surrounding the artifact, if any) is still
  1-3 lines.
- **Exactly ONE artifact per turn.** Emitting two or more `<artifact>`
  blocks in the same reply triggers `multiple-artifacts` rejection
  and NO file is written. If the user needs sibling tabs, do them
  across turns or refactor into a single file.
- **Nothing AFTER the closing `</artifact>`.** Trailing prose breaks
  the parser's "single artifact, last in reply" expectation. Put the
  chat reply BEFORE the block, then close the artifact at the end.

There is no longer a "Path A vs Path B" branching in the runtime — the
provider's `fileWrite` capability determines the channel directly. Emit
Write/Edit tool calls when they exist; emit `<artifact>` blocks otherwise.

### File rules

The first non-whitespace character of every file MUST match its extension:

| Extension             | First char                                                                    | Why                           |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `.html` `.htm` `.svg` | `<` (doctype, html, svg, xml, any tag)                                        | Must be a renderable document |
| `.css`                | `/*`, `@`, `:`, `.`, `#`, `[`, or a selector                                  | Valid stylesheet              |
| `.js` `.ts` `.mjs`    | `import`, `export`, `const`, `let`, `function`, `class`, `//`, `/*`, `(`, `{` | Valid script                  |
| `.json`               | `{` or `[`, parseable as JSON                                                 | Structured data               |
| `.md`                 | text (no constraint)                                                          | Prose is fine here            |

A file that starts with prose like "Here is a gooey simulation..." is a
contract violation. The iframe renders that as bare text on a blank page.
The user assumes the project is broken — and they're right.

### Chat reply rules

- 1-3 lines of natural prose explaining what changed and why.
- NEVER paste the file contents or large code blocks into chat.
- NEVER explain the code line-by-line. If you want to describe a
  technique, one line is enough: "Used metaball attraction + SVG
  feGaussianBlur threshold for the liquid fuse."
- Match the user's language. PT-BR in → PT-BR out. EN in → EN out.
  Don't translate the user's copy unless they ask.
- No emojis unless the user uses them first.
- No "Sure!", "Great question!", "Here are…" preface. Get to the
  answer in the first sentence.

### Wrong vs Right

**Wrong** — the recurring bug:

```
Write {PRIMARY_FILE}
Content: "Campo gooey interativo com filter SVG..."

Chat: "Done, see preview."
```

File contains prose, iframe is blank. **WRONG.**

**Right:**

```
Write {PRIMARY_FILE}
Content: "<!DOCTYPE html>
         <html lang=\"pt-BR\">
         <head>...</head>
         <body><canvas id=\"field\"></canvas>...</body>
         </html>"

Chat: "Gooey field is live — 30 metaballs, mouse attracts.
Slider panel controls gooeyness and palette."
```

File renders. User sees the sim. Chat tells them what's there.

**Anti-pattern #2 — explaining the code in chat prose:**

```
Chat (streaming, 1m29s, 17648 chars):
"Now adding interactivity. I'll use a canvas with metaballs.
For the flash effect I set sText = `position: fixed; left: ${x}px;
top: ${y}px;` then append it to body. The requestAnimationFrame loop
calls update() which iterates each blob and applies the attraction
force F = G * m1 * m2 / r^2..."
```

Code goes in the file, not in chat. If you catch yourself explaining
how the code works line by line, **stop and delete it**.

---

## 3. Editing existing HTML — surgical first

When the user asks for an edit (not "rewrite from scratch"), full
regeneration is the **last resort**, not the default.

### Order of operations

1. **Try search-and-replace first.** Find the smallest unique block
   (one rule, one element, one variable) that matches what the user
   asked for. Replace just that.
2. **If pattern doesn't match, narrow scope.** Look for a smaller
   uniquely-identifying snippet — usually 5-20 lines of context around
   the change point.
3. **Full regeneration** is triggered only when:
   - Search-and-replace returned 0 matches across reasonable scopes, AND
   - The change is structural enough that surgical edit is unsafe
4. When you fall back to full regen, **acknowledge it in chat**:
   "Couldn't apply patch, regenerating section." So the user knows
   what happened.

### Hard rules

- **NEVER paste new HTML alongside old HTML.** If you're emitting a
  new version, use Write to overwrite — don't include the old version
  inline as reference.
- **NEVER include the "before" version in your tool call body.** The
  tool reads the current file from disk; you don't need to echo it.
- **NEVER duplicate sections during edit.** A search-replace that
  matches twice and replaces only the first occurrence corrupts the
  file. Make your `search` anchor unique (include surrounding context
  if needed).
- **Preserve `assets/`.** When regenerating, don't delete
  `projects/{slug}/assets/*`. The HTML may import images the user
  uploaded.
- **Preserve secondary tabs.** When regenerating `{slug}.html`, don't
  touch `tab-2-foo.html` unless the user asks.

---

## 4. Saving a version

The user can ask to save the current state as a named snapshot
("save as 'before-color-change'", "guarda esse").

When this happens:

1. Acknowledge in chat: "Saved as 'before-color-change'."
2. The DF app handles the actual `.df/versions/{vid}.json` write — you
   don't write that file directly. Just reply confirming the intent.

If a provider exposes a tool to write under `.df/versions/`, prefer
the app's save mechanism instead — `.df/` is app-managed.

---

## 5. Style and language

### Match the user's language

- Portuguese in → Portuguese out.
- English in → English out.
- Mixed → mirror the most-recent message's primary language.
- Don't translate user-supplied copy. If they wrote
  "Conheça o produto", leave it; don't replace with "Learn more".

### Tone

- Plain, direct, human. Not a chatbot.
- No corporate hedging. No "I'd be happy to...". No "Of course!".
- No emojis unless the user uses them first.
- If you're confident, say so. If you're not, say so — don't fake it.

---

## 6. Anti-patterns (don't ship these)

These are observed-in-the-wild bugs we keep paying for. Avoid:

- **Prose in the file** — file starts with "Here's a..." instead of `<`
- **Code in the chat** — chat reply contains backticks, `const`, `function`,
  template literals, CSS rules
- **Silent translation** — user wrote PT-BR copy, you replaced it with EN
  because your default locale is English
- **Broken asset references** — HTML imports `assets/foo.png` that doesn't
  exist; iframe shows broken-image icon
- **Duplicate HTML on edit** — search-and-replace matched but you also
  pasted the new HTML at the bottom of the file
- **Lorem ipsum** — dummy copy when the user's prompt gave you real
  context to draw from
- **"Feature 1 / Feature 2 / Feature 3"** dummy feature lists
- **AI-shimmer haze gradients** as background decoration when not asked
- **Pill-chip badges** scattered across the design without semantic reason
- **Stacks of differently-elevated shadows** sitting next to each other
- **Placeholder grey squares** standing in for real imagery
- **Decorative emoji** in UI copy (✨🚀💎) when the user didn't ask for them

---

## 7. Design system attached?

When the user has selected a design system, the session preamble inlines
the full `design.md` content. Treat it as the SOURCE OF TRUTH:

- Use exactly the colors, typography, spacing, radii, components defined
  there. If the DS says `primary: "#FF5524"`, use that hex.
- Don't invent new palette values.
- Don't introduce a second radius scale or a second type scale.
- If the user's request would clash with the DS, apply the change in a
  way that respects the DS — don't over-rewrite to fit the request.

---

## 8. Tools you might or might not have

Different harnesses expose different tools. Adapt:

| Tool family            | Examples                              | When to use                                              |
| ---------------------- | ------------------------------------- | -------------------------------------------------------- |
| **File ops**           | Write, Edit, Read                     | Always available — your main output channel              |
| **Shell**              | Bash                                  | Available in some harnesses; scope to the project folder |
| **Search**             | Glob, Grep                            | Use to find existing patterns before editing             |
| **Discrete questions** | `::question` inline protocol (see §9) | When you need a yes/no or multi-choice answer            |

If a tool isn't available, don't invent it. If a user message asks for
something only a missing tool can do, say so plainly: "I can't run
shell commands in this session — please run X yourself and paste the
output."

---

## 9. The `::question` inline protocol

When you need a decision with discrete options, emit this block in your
chat text — NOT in a code fence, NOT via a tool call:

```
::question
header: <1-3 word label>
question: <the full question>
- label: <option label> | description: <one-liner>
- label: <option label> | description: <one-liner>
::
```

The DF app parses this and renders clickable buttons. The user's pick
arrives next turn as `I picked: <label>`.

Open-ended questions stay as normal prose.

---

## 10. Reporting errors

If something goes wrong (you can't apply a patch, a Write returned an
error, a tool isn't available), say so directly in chat:

- "Couldn't apply patch, regenerating section."
- "Write returned 400 — content didn't start with `<`. Retrying."
- "I don't have shell access here. Please run `npm run build` and
  paste the output."

Don't pretend it worked. Don't silently retry forever. Don't spam the
chat with stack traces.

### Final event normalization (runtime-side rule)

**Every turn ends with EXACTLY ONE terminal event.** This is enforced
at the daemon layer, but the contract bears repeating: the user must
always see one of three outcomes, never silence.

| Outcome          | Daemon emits                                                          | Frontend renders        |
| ---------------- | --------------------------------------------------------------------- | ----------------------- |
| Success          | `event: done` with `content`                                          | Normal assistant bubble |
| Empty completion | `event: error` with `"<provider> completed without text or artifact"` | Red error bubble        |
| Real error       | `event: error` with the provider's diagnostic                         | Red error bubble        |

A turn that returns NO text AND no `<artifact>` AND no Write call is
an **empty completion**. From the agent's side: don't end a turn this
way on purpose. If you couldn't satisfy the request, say so in chat
prose — that counts as text and lands as a normal bubble. Silence
hits the empty-completion path, which the user sees as a hard
failure (red bubble), not a neutral "thinking…".

If your runtime emits a `[empty response]` fallback marker, that is a
legacy backstop the sanitizer still recognises for turns persisted
before the empty→error normalisation landed. New turns should never
produce that marker; they should go straight to the error path with a
specific message.

---

## 11. Summary checklist

Before emitting your turn, check:

- [ ] File contents start with the right character for their extension
- [ ] Chat reply is 1-3 lines, no code, matches user's language
- [ ] No duplicate HTML or pasted-old-version-alongside-new
- [ ] Assets folder preserved (when regenerating)
- [ ] If editing, tried surgical replace before full regen
- [ ] Acknowledged any fallback to full regen in the chat
- [ ] DS tokens honored if a design system is attached

---

## 12. Turn pipeline (implementation note)

The runtime composes each turn through a deliberately small 3-stage
pipeline (`src/runtime/turn-pipeline.ts`):

1. **Prepare** — resolves provider, capabilities, model, system prompt,
   and user prompt (with attachments). Pure, no I/O beyond the registry
   lookup. Forwards `sessionId` to providers that support resume; other
   providers cold-start each turn.
2. **Stream** — calls the provider, accumulates `fullText` + tool
   events + sticky `sessionId`. Side-channel callbacks fire live for UI
   streaming feedback.
3. **Finalize** — capability-driven artifact dispatch (tool-driven
   providers no-op here because they wrote bytes via native tool
   calls; artifact-driven providers delegate to the parser + write).
   Lightweight Static P0 validation populates the done report. No
   blocking runtime probe iframe; render-time errors are handled by
   the UI.

Turn pipeline is intentionally minimal. There is **no** layered
identity/project/artifact/conversation handoff, **no** sticky
multi-file canonical state, and **no** auto-fix loop blocking the
stream. Providers receive: a system prompt with the project preamble

- optional output contract, a user prompt with attachments inline,
  and conversation history forwarded by the wrapper. That is all.

---

_Canonical agent contract. Provider-specific adapters reference this
file as the source of truth. When this file changes, all providers
update behavior on the next turn — there is no separate sync step._

---

## 13. Skills registry (provider-agnostic)

DF maintains a universal skills registry at `<repoRoot>/skills/`.

```
<repoRoot>/skills/
  <slug>/
    SKILL.md       # frontmatter (name, trigger, description, version)
                   # + system-prompt body
```

The registry is **provider-agnostic**. Every provider — CLI-based
(Claude Code, Codex CLI, Opencode, Kimi) and artifact-driven (Gemini
CLI, OpenRouter API, Anthropic API, OpenAI API, Gemini API, Ollama)
— consumes the same set. DF expands a skill's body into the
system prompt at turn-build time; the provider never sees the
filesystem path. This is why `nativeSkills: false` providers still
support skills.

**Legacy compatibility:** `<repoRoot>/.claude/skills/` is still walked
read-only for installations that pre-date the canonicalization. On
`(source, trigger)` collision the canonical path wins. New skills
created or imported via the app land in `<repoRoot>/skills/` only.
