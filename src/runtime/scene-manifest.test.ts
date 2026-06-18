import { describe, expect, it } from "vitest";
import {
  parseSceneManifest,
  applySceneEdit,
  resizeSceneAndRipple,
  findReplaceInScene,
  extractSceneTextSnippets,
  buildSceneRefinePrompt,
} from "./scene-manifest";

const HTML_FIXTURE = `
<!DOCTYPE html>
<html><body>
  <section data-scene="01" data-start="0" data-duration="3" data-name="Opening">
    <h1>Hello world</h1>
    <p>Intro line</p>
  </section>
  <section data-scene="02" data-start="3" data-duration="5" data-name="Middle">
    <h2>Middle headline</h2>
    <span>some span text</span>
  </section>
  <section data-scene="03" data-start="8" data-duration="4" data-name="End">
    <p>Closing thought</p>
  </section>
  <script type="application/df-manifest">
{
  "duration": 12,
  "fps": 30,
  "scenes": [
    { "id": "01", "name": "Opening", "start": 0, "duration": 3 },
    { "id": "02", "name": "Middle", "start": 3, "duration": 5 },
    { "id": "03", "name": "End", "start": 8, "duration": 4 }
  ]
}
  </script>
</body></html>`;

describe("parseSceneManifest", () => {
  it("prefers the explicit manifest tag", () => {
    const m = parseSceneManifest(HTML_FIXTURE);
    expect(m).not.toBeNull();
    expect(m!.fromManifestTag).toBe(true);
    expect(m!.scenes).toHaveLength(3);
    expect(m!.duration).toBe(12);
    expect(m!.fps).toBe(30);
  });

  it("falls back to data-scene scrape when manifest tag is missing", () => {
    const html = HTML_FIXTURE.replace(/<script[^>]*df-manifest[\s\S]*?<\/script>/, "");
    const m = parseSceneManifest(html);
    expect(m).not.toBeNull();
    expect(m!.fromManifestTag).toBe(false);
    expect(m!.scenes).toHaveLength(3);
  });

  it("returns null when neither tag nor data-scene exist", () => {
    expect(parseSceneManifest("<div>nothing</div>")).toBeNull();
    expect(parseSceneManifest("")).toBeNull();
  });
});

describe("applySceneEdit", () => {
  it("updates data-* attrs on the section", () => {
    const out = applySceneEdit(HTML_FIXTURE, "02", { start: 4, duration: 6 });
    expect(out).toContain('data-scene="02"');
    expect(out).toContain('data-start="4"');
    expect(out).toContain('data-duration="6"');
  });

  it("updates the manifest JSON in place", () => {
    const out = applySceneEdit(HTML_FIXTURE, "02", { duration: 6 });
    const m = parseSceneManifest(out);
    expect(m!.scenes.find((s) => s.id === "02")?.duration).toBe(6);
  });

  it("renames the scene when name patch passed", () => {
    const out = applySceneEdit(HTML_FIXTURE, "01", { name: "Opener" });
    expect(out).toContain('data-name="Opener"');
    const m = parseSceneManifest(out);
    expect(m!.scenes.find((s) => s.id === "01")?.name).toBe("Opener");
  });

  it("is a structural no-op when sceneId doesn't exist", () => {
    // applySceneEdit may reformat the manifest JSON even when the
    // sceneId isn't found — what matters is the PARSED data is
    // identical, not the raw bytes.
    const before = parseSceneManifest(HTML_FIXTURE)!;
    const out = applySceneEdit(HTML_FIXTURE, "99", { duration: 1 });
    const after = parseSceneManifest(out)!;
    expect(after.scenes).toEqual(before.scenes);
    expect(after.duration).toEqual(before.duration);
  });
});

describe("resizeSceneAndRipple", () => {
  it("ripple-shifts later scenes when middle scene grows", () => {
    const m = parseSceneManifest(HTML_FIXTURE)!;
    const out = resizeSceneAndRipple(HTML_FIXTURE, m, "02", 7); // was 5 → 7, +2s
    const next = parseSceneManifest(out)!;
    expect(next.scenes.find((s) => s.id === "02")?.duration).toBe(7);
    // Scene 03 was at start=8; should shift +2 → 10
    expect(next.scenes.find((s) => s.id === "03")?.start).toBe(10);
    // Scene 01 should NOT move (started before 02)
    expect(next.scenes.find((s) => s.id === "01")?.start).toBe(0);
  });

  it("doesn't ripple when the last scene is resized (nothing after)", () => {
    const m = parseSceneManifest(HTML_FIXTURE)!;
    const out = resizeSceneAndRipple(HTML_FIXTURE, m, "03", 6);
    const next = parseSceneManifest(out)!;
    expect(next.scenes.find((s) => s.id === "03")?.duration).toBe(6);
    expect(next.scenes.find((s) => s.id === "01")?.start).toBe(0);
    expect(next.scenes.find((s) => s.id === "02")?.start).toBe(3);
  });

  it("clamps duration to a minimum of 0.1s", () => {
    const m = parseSceneManifest(HTML_FIXTURE)!;
    const out = resizeSceneAndRipple(HTML_FIXTURE, m, "01", -1);
    const next = parseSceneManifest(out)!;
    expect(next.scenes.find((s) => s.id === "01")?.duration).toBe(0.1);
  });
});

describe("findReplaceInScene", () => {
  it("replaces text only inside the targeted scene", () => {
    const out = findReplaceInScene(HTML_FIXTURE, "01", "Hello world", "Olá mundo");
    expect(out.changed).toBe(true);
    expect(out.html).toContain("Olá mundo");
    // Scene 02's content untouched
    expect(out.html).toContain("Middle headline");
  });

  it("returns changed=false when find string not in scene", () => {
    const out = findReplaceInScene(HTML_FIXTURE, "01", "no such string", "x");
    expect(out.changed).toBe(false);
    expect(out.html).toBe(HTML_FIXTURE);
  });

  it("only replaces in the scoped scene, not other scenes with same text", () => {
    const html = HTML_FIXTURE.replace("Middle headline", "Hello world");
    const out = findReplaceInScene(html, "01", "Hello world", "Replaced");
    // Scene 01's "Hello world" replaced but scene 02's left alone
    const sec01Match = out.html.match(/data-scene="01"[\s\S]*?<\/section>/);
    const sec02Match = out.html.match(/data-scene="02"[\s\S]*?<\/section>/);
    expect(sec01Match![0]).toContain("Replaced");
    expect(sec02Match![0]).toContain("Hello world");
  });
});

describe("extractSceneTextSnippets", () => {
  it("returns leaf-text from headline / paragraph / span tags", () => {
    const snippets = extractSceneTextSnippets(HTML_FIXTURE, "02");
    expect(snippets).toContain("Middle headline");
    expect(snippets).toContain("some span text");
  });

  it("dedupes repeated text", () => {
    const html = HTML_FIXTURE.replace("<h2>Middle headline</h2>", "<h2>Repeat</h2><p>Repeat</p>");
    const snippets = extractSceneTextSnippets(html, "02");
    const repeats = snippets.filter((s) => s === "Repeat");
    expect(repeats).toHaveLength(1);
  });

  it("returns empty array when scene id not found", () => {
    expect(extractSceneTextSnippets(HTML_FIXTURE, "99")).toEqual([]);
  });
});

describe("buildSceneRefinePrompt", () => {
  it("includes scene id, name, and time range", () => {
    const m = parseSceneManifest(HTML_FIXTURE)!;
    const scene = m.scenes[1];
    const prompt = buildSceneRefinePrompt(scene, "make it pop more");
    expect(prompt).toContain("scene 02");
    expect(prompt).toContain('"Middle"');
    expect(prompt).toContain("t=3-8s");
    expect(prompt).toContain("make it pop more");
  });

  it("warns AI not to renumber other scenes", () => {
    const scene = parseSceneManifest(HTML_FIXTURE)!.scenes[0];
    const prompt = buildSceneRefinePrompt(scene, "");
    expect(prompt).toContain("Do NOT renumber");
    expect(prompt).toContain("data-scene/data-start/data-duration");
  });
});
