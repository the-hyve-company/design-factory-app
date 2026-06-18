// scene-manifest.ts — Extracts the DF scene manifest from generated HTML.
//
// Contract (taught to the AI in the video format prompts):
//   <section data-scene="01" data-start="0" data-duration="3" data-name="Opening">
//     ...
//   </section>
//   <script type="application/df-manifest">
//     { "duration": 18, "fps": 30, "scenes": [{ "id": "01", "name": "Opening", "start": 0, "duration": 3 }, ...] }
//   </script>
//
// The parser is forgiving:
//   1. Manifest <script> wins when present.
//   2. Falls back to scraping data-scene attributes from <section>s.
//   3. Returns null when neither is present (caller falls back to the
//      legacy timeline-parser).

export interface Scene {
  id: string;
  name: string;
  start: number; // seconds
  duration: number; // seconds
}

export interface SceneManifest {
  duration: number; // seconds, total
  fps: number;
  scenes: Scene[];
  /** True if parsed from the explicit <script df-manifest>; false if
   *  derived from data-scene attributes (less authoritative). */
  fromManifestTag: boolean;
}

const MANIFEST_RE = /<script\s+type=["']application\/df-manifest["'][^>]*>([\s\S]*?)<\/script>/i;

const SECTION_RE = /<section\b([^>]*?)>/gi;

function readAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}=["']([^"']*)["']`, "i");
  const m = tag.match(re);
  return m ? m[1] : null;
}

function num(v: string | null, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const cleaned = String(v).trim().replace(/s$/i, ""); // tolerate "3s"
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Try to extract the manifest from the HTML. Returns null when neither
 * an explicit <script df-manifest> nor any data-scene sections are found.
 *
 * Sections are the source of truth — the editor's resize / find-replace /
 * scoped-refine all use `data-scene` as the lookup key, so the scene id
 * we surface MUST match the attribute on the DOM element. The manifest
 * tag is treated as a hint: useful for fps and total duration, but its
 * scene shape is overridden whenever the HTML has matching <section>s.
 */
export function parseSceneManifest(html: string): SceneManifest | null {
  if (!html) return null;

  // Always scrape sections first. data-scene attrs are the authoritative
  // ids the editor manipulates — using them avoids the "manifest
  // derives id from name → mismatch with section attribute" trap that
  // breaks scoped editing.
  const sectionScenes: Scene[] = [];
  let match: RegExpExecArray | null;
  SECTION_RE.lastIndex = 0;
  while ((match = SECTION_RE.exec(html)) !== null) {
    const attrs = match[1];
    const id = readAttr(attrs, "data-scene");
    if (!id) continue;
    const start = num(readAttr(attrs, "data-start"));
    const duration = num(readAttr(attrs, "data-duration"));
    const name = readAttr(attrs, "data-name") ?? `Scene ${id}`;
    if (duration <= 0) continue;
    sectionScenes.push({ id, name, start, duration });
  }

  // Optional manifest tag — used only for fps + top-level duration when
  // we have section scenes; used as scene source only when there are no
  // sections at all.
  const m = html.match(MANIFEST_RE);
  let manifestJson: Partial<SceneManifest> | null = null;
  if (m) {
    try {
      manifestJson = JSON.parse(m[1]) as Partial<SceneManifest>;
    } catch {
      manifestJson = null;
    }
  }

  if (sectionScenes.length > 0) {
    sectionScenes.sort((a, b) => a.start - b.start);
    const fps = typeof manifestJson?.fps === "number" ? manifestJson.fps : 30;
    const total =
      typeof manifestJson?.duration === "number"
        ? manifestJson.duration
        : sumDuration(sectionScenes, true);
    return {
      duration: total,
      fps,
      scenes: sectionScenes,
      fromManifestTag: !!manifestJson,
    };
  }

  // No sections — fall back to the manifest tag as the only source.
  // We can still derive a usable id from name (slugified) since there's
  // no section attribute to disagree with.
  if (manifestJson) {
    const rawScenes = Array.isArray(manifestJson.scenes) ? manifestJson.scenes : [];
    const scenes = (rawScenes as Array<Partial<Scene>>)
      .filter((s) => s && typeof s.start === "number" && typeof s.duration === "number")
      .map((s, i) => {
        const name = typeof s.name === "string" ? s.name : `Scene ${i + 1}`;
        const id =
          typeof s.id === "string" && s.id.length > 0
            ? s.id
            : name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || `s${i + 1}`;
        return {
          id,
          name,
          start: Number(s.start),
          duration: Math.max(0, Number(s.duration)),
        };
      });
    if (scenes.length > 0) {
      const total =
        typeof manifestJson.duration === "number" ? manifestJson.duration : sumDuration(scenes);
      const fps = typeof manifestJson.fps === "number" ? manifestJson.fps : 30;
      return {
        duration: total,
        fps,
        scenes,
        fromManifestTag: true,
      };
    }
  }

  return null;
}

function sumDuration(scenes: Scene[], useEnd = false): number {
  if (scenes.length === 0) return 0;
  if (useEnd) {
    return scenes.reduce((max, s) => Math.max(max, s.start + s.duration), 0);
  }
  return scenes[scenes.length - 1].start + scenes[scenes.length - 1].duration;
}

/**
 * Build a scene-scoped refine prompt. Used by the Refine button in the
 * scene panel — sends the AI a targeted edit request that says "touch
 * only this scene".
 */
export function buildSceneRefinePrompt(scene: Scene, userInstruction: string): string {
  const instr =
    userInstruction.trim() ||
    "Improve this scene's animation and composition without breaking the overall timeline.";
  return [
    `Edit ONLY scene ${scene.id} ("${scene.name}", t=${scene.start}-${scene.start + scene.duration}s).`,
    "Keep all other scenes' content, classes, ids, and animation timings intact.",
    "Preserve the data-scene/data-start/data-duration attributes on every <section>.",
    'Preserve the <script type="application/df-manifest"> JSON manifest exactly.',
    "Do NOT renumber scenes or shift other scenes' start times.",
    "",
    `Instruction for scene ${scene.id}:`,
    instr,
  ].join("\n");
}

/**
 * Mutate scene timing (start/duration) inline in the HTML string. Updates
 * the <section data-*> attrs AND the <script df-manifest> JSON. Returns
 * the new HTML string.
 *
 * Caveat: this does NOT recompute @keyframes — the AI's CSS still uses
 * the original animation-delay values. For a "live" timing edit we'd
 * need to either (a) regenerate the CSS, or (b) ask the AI to refactor
 * the keyframes to read from CSS variables we mutate. Phase 2 work.
 */
export function applySceneEdit(
  html: string,
  sceneId: string,
  patch: Partial<Pick<Scene, "start" | "duration" | "name">>,
): string {
  let out = html;

  // 1) Mutate the <section> attrs.
  const sectionRe = new RegExp(`(<section\\b[^>]*data-scene=["']${sceneId}["'][^>]*>)`, "i");
  out = out.replace(sectionRe, (_full, openTag) => {
    let tag = openTag as string;
    if (typeof patch.start === "number") {
      tag = upsertAttr(tag, "data-start", String(patch.start));
    }
    if (typeof patch.duration === "number") {
      tag = upsertAttr(tag, "data-duration", String(patch.duration));
    }
    if (typeof patch.name === "string") {
      tag = upsertAttr(tag, "data-name", patch.name);
    }
    return tag;
  });

  // 2) Mutate the manifest JSON. Stamp manifest_version on every emit so
  // consumers (validator, migrator) can route by version forward.
  out = out.replace(MANIFEST_RE, (_, body: string) => {
    try {
      const json = JSON.parse(body) as SceneManifest;
      const scenes = (json.scenes || []).map((s) =>
        s.id === sceneId
          ? {
              ...s,
              ...(patch.start !== undefined ? { start: patch.start } : {}),
              ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
              ...(patch.name !== undefined ? { name: patch.name } : {}),
            }
          : s,
      );
      const total = scenes.reduce((max, s) => Math.max(max, s.start + s.duration), 0);
      const next = {
        manifest_version: 1,
        ...json,
        scenes,
        duration: total,
        fromManifestTag: true,
      };
      return `<script type="application/df-manifest">\n${JSON.stringify(next, null, 2)}\n</script>`;
    } catch {
      return _; // leave unchanged on parse error
    }
  });

  return out;
}

function upsertAttr(openTag: string, attr: string, value: string): string {
  const re = new RegExp(`\\b${attr}=["'][^"']*["']`, "i");
  if (re.test(openTag)) {
    return openTag.replace(re, `${attr}="${value}"`);
  }
  return openTag.replace(/<section\b/i, `<section ${attr}="${value}"`);
}

/**
 * Resize a scene by a delta in seconds, ripple-shifting all scenes that
 * start AFTER it by the same delta. Returns the new HTML string.
 *
 * Used by drag-to-retime in SceneTimeline. Section attrs and the
 * <script df-manifest> JSON both move; CSS keyframes do not — that
 * requires AI refine for now, so the UI shows a note.
 */
export function resizeSceneAndRipple(
  html: string,
  manifest: SceneManifest,
  sceneId: string,
  newDuration: number,
): string {
  const target = manifest.scenes.find((s) => s.id === sceneId);
  if (!target) return html;
  const safeDuration = Math.max(0.1, newDuration);
  const delta = safeDuration - target.duration;

  let out = applySceneEdit(html, sceneId, { duration: safeDuration });
  if (delta === 0) return out;

  // Ripple: every scene whose start was AFTER this one's start shifts.
  for (const s of manifest.scenes) {
    if (s.id === sceneId) continue;
    if (s.start <= target.start) continue;
    out = applySceneEdit(out, s.id, { start: s.start + delta });
  }
  return out;
}

/**
 * Find/replace a single text snippet INSIDE a scene's <section> block,
 * leaving sections outside untouched. Returns the new HTML string. If
 * the find string isn't found within the scene, html is returned
 * unchanged.
 *
 * Used by the per-scene text editor. Conservative: only the FIRST match
 * inside the scene is replaced so the user can repeat the call to swap
 * subsequent occurrences. We escape the find string for regex safety.
 */
export function findReplaceInScene(
  html: string,
  sceneId: string,
  find: string,
  replace: string,
): { html: string; changed: boolean } {
  if (!find) return { html, changed: false };
  const sectionRe = new RegExp(
    `(<section\\b[^>]*data-scene=["']${sceneId}["'][^>]*>)([\\s\\S]*?)(</section>)`,
    "i",
  );
  const m = html.match(sectionRe);
  if (!m) return { html, changed: false };
  const inner = m[2];
  if (!inner.includes(find)) return { html, changed: false };
  const updated = inner.replace(find, replace);
  const next = html.slice(0, m.index!) + m[1] + updated + m[3] + html.slice(m.index! + m[0].length);
  return { html: next, changed: true };
}

/**
 * Extract human-editable text snippets from a scene block. Used to seed
 * the per-scene text editor — show the user what's editable, let them
 * change a value inline, and we use findReplaceInScene to commit.
 *
 * Heuristic: collect the trimmed innerText of headline / paragraph /
 * span / list-item nodes that have NO child elements (i.e. leaf text).
 * Dedup by value so the editor list isn't repetitive.
 */
export function extractSceneTextSnippets(html: string, sceneId: string): string[] {
  const sectionRe = new RegExp(
    `<section\\b[^>]*data-scene=["']${sceneId}["'][^>]*>([\\s\\S]*?)</section>`,
    "i",
  );
  const m = html.match(sectionRe);
  if (!m) return [];
  // We can't safely use DOMParser inside this module (test envs don't
  // have it), but the SceneTimeline component runs in the browser. So
  // we surface a lightweight regex-based extraction that grabs leaf
  // text inside common text-bearing tags, good enough for the v1 editor.
  const TAG_RE = /<(h[1-6]|p|span|em|strong|li|button)\b[^>]*>([^<]+)<\/\1>/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let mm: RegExpExecArray | null;
  while ((mm = TAG_RE.exec(m[1])) !== null) {
    const t = mm[2].trim();
    if (!t || t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 24) break; // cap to keep the panel manageable
  }
  return out;
}
