import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";

import { resolveArtifactTarget, __TEST_INTERNALS__ } from "./resolve-artifact-target.mjs";

let projectsRoot;
let slug;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "df-rat-"));
  slug = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await mkdir(join(root, slug), { recursive: true });
  projectsRoot = realpathSync(root);
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true });
});

function baseInput(overrides = {}) {
  return {
    projectId: slug,
    requestedIdentifier: `projects/${slug}/index.html`,
    currentActiveFile: `projects/${slug}/index.html`,
    currentPrimaryFile: `projects/${slug}/index.html`,
    requestedType: "text/html",
    existingFiles: {
      [`projects/${slug}/index.html`]: { type: "text/html", role: "primary" },
    },
    ...overrides,
  };
}

describe("normalizeIdentifier (internal)", () => {
  it("accepts already-normalised path", () => {
    const r = __TEST_INTERNALS__.normalizeIdentifier(`projects/${slug}/index.html`, slug);
    expect(r).toBe(`projects/${slug}/index.html`);
  });

  it("prepends projects/{slug}/ when prefix missing", () => {
    const r = __TEST_INTERNALS__.normalizeIdentifier("variants/dark.html", slug);
    expect(r).toBe(`projects/${slug}/variants/dark.html`);
  });

  it("strips leading ./ and slashes", () => {
    const r = __TEST_INTERNALS__.normalizeIdentifier("./index.html", slug);
    expect(r).toBe(`projects/${slug}/index.html`);
  });

  it("normalises backslashes to forward slashes", () => {
    const r = __TEST_INTERNALS__.normalizeIdentifier("variants\\dark.html", slug);
    expect(r).toBe(`projects/${slug}/variants/dark.html`);
  });

  it("rejects when projects/ prefix references different slug", () => {
    const r = __TEST_INTERNALS__.normalizeIdentifier("projects/other/index.html", slug);
    expect(r).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(__TEST_INTERNALS__.normalizeIdentifier("", slug)).toBeNull();
    expect(__TEST_INTERNALS__.normalizeIdentifier("anything", "")).toBeNull();
  });
});

describe("resolveArtifactTarget — happy paths", () => {
  it("override primary file", () => {
    const r = resolveArtifactTarget(baseInput(), projectsRoot);
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("primary");
    expect(r.previewAfterWrite).toBe(true);
    expect(r.setActive).toBe(true);
    expect(r.setPrimary).toBe(false);
    expect(r.isNewFile).toBe(false);
  });

  it("override activeFile when it differs from primaryFile", () => {
    const variant = `projects/${slug}/variants/dark.html`;
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: variant,
        currentActiveFile: variant,
        existingFiles: {
          [`projects/${slug}/index.html`]: { type: "text/html", role: "primary" },
          [variant]: { type: "text/html", role: "variant" },
        },
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("primary"); // override semantics: activeFile match → primary path
    expect(r.previewAfterWrite).toBe(true);
    expect(r.isNewFile).toBe(false);
  });

  it("new variant under variants/", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/variants/new-take.html`,
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("variant");
    expect(r.previewAfterWrite).toBe(true);
    expect(r.setActive).toBe(true);
    expect(r.setPrimary).toBe(false);
    expect(r.isNewFile).toBe(true);
    expect(r.parent).toBe(`projects/${slug}/index.html`);
  });

  it("new doc under docs/ does not move activeFile", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/docs/notes.md`,
        requestedType: "text/markdown",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("doc");
    expect(r.previewAfterWrite).toBe(false);
    expect(r.setActive).toBe(false);
  });

  it("new prompt under prompts/", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/prompts/brief.txt`,
        requestedType: "text/plain",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("prompt");
    expect(r.previewAfterWrite).toBe(false);
    expect(r.setActive).toBe(false);
  });

  it("new data under data/", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/data/config.json`,
        requestedType: "application/json",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("data");
    expect(r.previewAfterWrite).toBe(false);
  });

  it("new asset under assets/images/", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/assets/images/logo.png`,
        requestedType: "image/png",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("asset");
    expect(r.previewAfterWrite).toBe(false);
  });

  it("normalises identifier without projects/ prefix", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: "variants/foo.html",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.normalizedIdentifier).toBe(`projects/${slug}/variants/foo.html`);
    expect(r.role).toBe("variant");
  });
});

describe("resolveArtifactTarget — intent semantics", () => {
  it("intent=override against active file passes", () => {
    const r = resolveArtifactTarget(baseInput({ intent: "override" }), projectsRoot);
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("primary");
  });

  it("intent=override against unknown path returns INTENT_PATH_CONFLICT", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/variants/never-seen.html`,
        intent: "override",
      }),
      projectsRoot,
    );
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("INTENT_PATH_CONFLICT");
  });

  it("intent=variant for path inside variants/ passes", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/variants/dark.html`,
        intent: "variant",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("variant");
  });

  it("intent=doc for path inside variants/ returns INTENT_PATH_CONFLICT", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/variants/dark.html`,
        intent: "doc",
      }),
      projectsRoot,
    );
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("INTENT_PATH_CONFLICT");
  });

  it("unknown intent returns BAD_REQUEST", () => {
    const r = resolveArtifactTarget(baseInput({ intent: "wat" }), projectsRoot);
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("BAD_REQUEST");
  });
});

describe("resolveArtifactTarget — path scope + ambiguity", () => {
  it("rejects path that escapes projectsRoot via ..", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/../../etc/passwd`,
      }),
      projectsRoot,
    );
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("PATH_OUT_OF_SCOPE");
  });

  it("rejects identifier referencing different project slug", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: "projects/other-project/index.html",
      }),
      projectsRoot,
    );
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("AMBIGUOUS_IDENTIFIER");
  });

  it("returns AMBIGUOUS_IDENTIFIER for top-level non-canonical name without intent or type hint", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/something.weird`,
        requestedType: "",
      }),
      projectsRoot,
    );
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("AMBIGUOUS_IDENTIFIER");
  });

  it("uses type fallback when no folder hint and no intent", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/something.html`,
        requestedType: "text/html",
      }),
      projectsRoot,
    );
    expect(r.error).toBeUndefined();
    // Top-level previewable but not canonical name → variant fallback.
    expect(r.role).toBe("variant");
  });
});

describe("resolveArtifactTarget — type/role mismatch", () => {
  it("rejects type=text/html in assets/ folder (asset role expected)", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/assets/scripts/foo.html`,
        requestedType: "text/html",
      }),
      projectsRoot,
    );
    // Path puts it as asset; type=text/html allowed only for primary/variant.
    // INVALID_ROLE because type is restricted by TYPE_TO_DEFAULT_ROLES.
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("INVALID_ROLE");
  });

  it("rejects type=application/json in variants/ folder", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/variants/dark.json`,
        requestedType: "application/json",
      }),
      projectsRoot,
    );
    expect(r.error).toBeDefined();
    expect(r.error.code).toBe("INVALID_ROLE");
  });

  it("accepts svg in primary slot (svg is allowed for primary/variant/asset)", () => {
    const r = resolveArtifactTarget(
      baseInput({
        requestedIdentifier: `projects/${slug}/index.html`,
        requestedType: "image/svg+xml",
      }),
      projectsRoot,
    );
    // identifier matches primaryFile string → role=primary, svg is allowed for primary.
    expect(r.error).toBeUndefined();
    expect(r.role).toBe("primary");
  });
});

describe("resolveArtifactTarget — input validation", () => {
  it("requires projectId", () => {
    const r = resolveArtifactTarget({ ...baseInput(), projectId: "" }, projectsRoot);
    expect(r.error.code).toBe("BAD_REQUEST");
  });

  it("requires projectsRoot", () => {
    const r = resolveArtifactTarget(baseInput(), "");
    expect(r.error.code).toBe("BAD_REQUEST");
  });

  it("requires requestedIdentifier", () => {
    const r = resolveArtifactTarget({ ...baseInput(), requestedIdentifier: "" }, projectsRoot);
    expect(r.error.code).toBe("BAD_REQUEST");
  });
});

describe("internal helpers", () => {
  it("inferTypeFromPath maps common extensions", () => {
    expect(__TEST_INTERNALS__.inferTypeFromPath("foo.html")).toBe("text/html");
    expect(__TEST_INTERNALS__.inferTypeFromPath("foo.md")).toBe("text/markdown");
    expect(__TEST_INTERNALS__.inferTypeFromPath("foo.png")).toBe("image/png");
    expect(__TEST_INTERNALS__.inferTypeFromPath("foo.unknown")).toBeNull();
  });

  it("previewableForType matches HTML family", () => {
    expect(__TEST_INTERNALS__.previewableForType("text/html")).toBe(true);
    expect(__TEST_INTERNALS__.previewableForType("image/svg+xml")).toBe(true);
    expect(__TEST_INTERNALS__.previewableForType("text/markdown")).toBe(false);
    expect(__TEST_INTERNALS__.previewableForType("")).toBe(false);
  });

  it("isTypeRoleConsistent allows unknown types (no constraint)", () => {
    expect(__TEST_INTERNALS__.isTypeRoleConsistent("application/x-weird", "primary")).toBe(true);
  });

  it("roleFromPath returns null for unknown subfolder", () => {
    expect(__TEST_INTERNALS__.roleFromPath(`projects/${slug}/weird/x.html`, slug)).toBeNull();
  });
});
