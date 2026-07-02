// artifact-path-parity.test.ts — audit WS3 `artifact-identifier-parity`.
//
// The 6 artifact-channel providers materialize files through the
// `<artifact identifier="...">` contract, while the 4 tool-channel ones
// write via the absolute PROJECT_PATH binding. Before the shared
// `toRepoRelativeArtifactPath` helper, the generate path and the verb
// path computed the identifier differently — an absolute projectPath
// leaked through the generate path whole and the daemon's
// normalizeIdentifier re-prefixed it into a bogus nested path (role
// "variant" instead of the primary override).
//
// Three locks here:
//   1. unit semantics of the helper (POSIX, Windows, `~`, fallbacks);
//   2. generate path ↔ verb path emit the SAME identifier for the same
//      project context;
//   3. cross-layer: the identifier the front emits normalizes 1:1 under
//      the daemon's resolve-artifact-target normalizeIdentifier — i.e.
//      the artifact lands exactly on `projects/<slug>/<primaryFile>`,
//      the same file the tool channel writes.

import { describe, it, expect } from "vitest";
import { toRepoRelativeArtifactPath } from "./output-contract";
import { artifactContractForCtx, composeSystemBlocks } from "./prompt-composer";
import { prepare, type UserTurnInput } from "./turn-pipeline";
import type { ProjectContext } from "./prompt-composer";
// Daemon-side normalization — same import style as static-p0-parity.test.ts.
import { __TEST_INTERNALS__ } from "../../apps/daemon/src/resolve-artifact-target.mjs";

const { normalizeIdentifier } = __TEST_INTERNALS__ as {
  normalizeIdentifier: (identifier: string, projectId: string) => string | null;
};

// ─── 1. Helper semantics ─────────────────────────────────────────────────

describe("toRepoRelativeArtifactPath — canonical identifier", () => {
  it("reduces an absolute POSIX path to the projects/<slug> stem", () => {
    expect(toRepoRelativeArtifactPath("/home/nik/design-factory/projects/my-app", "index.html")).toBe(
      "projects/my-app/index.html",
    );
  });

  it("reduces a ~-prefixed path to the projects/<slug> stem", () => {
    expect(
      toRepoRelativeArtifactPath("~/design-factory/projects/fixture-project", "fixture.html"),
    ).toBe("projects/fixture-project/fixture.html");
  });

  it("normalizes Windows separators before matching", () => {
    expect(
      toRepoRelativeArtifactPath("C:\\Users\\nik\\design-factory\\projects\\my-app", "index.html"),
    ).toBe("projects/my-app/index.html");
  });

  it("accepts a bare projects/<slug> path verbatim", () => {
    expect(toRepoRelativeArtifactPath("projects/my-app", "index.html")).toBe(
      "projects/my-app/index.html",
    );
    expect(toRepoRelativeArtifactPath("projects/my-app/", "index.html")).toBe(
      "projects/my-app/index.html",
    );
  });

  it("keeps a non-projects path as-is after tilde-strip (daemon prefixes it)", () => {
    // The legacy default projectPath has no projects/ segment — the daemon's
    // normalizeIdentifier prefixes it under projects/<projectId>/.
    expect(toRepoRelativeArtifactPath("~/design-factory/projeto", "index.html")).toBe(
      "design-factory/projeto/index.html",
    );
  });

  it("falls back to projects/default when the path is empty", () => {
    expect(toRepoRelativeArtifactPath("", "index.html")).toBe("projects/default/index.html");
    expect(toRepoRelativeArtifactPath(undefined, "index.html")).toBe(
      "projects/default/index.html",
    );
    expect(toRepoRelativeArtifactPath("~", "index.html")).toBe("projects/default/index.html");
  });

  it("falls back to index.html when primaryFile is missing", () => {
    expect(toRepoRelativeArtifactPath("projects/my-app", undefined)).toBe(
      "projects/my-app/index.html",
    );
    expect(toRepoRelativeArtifactPath("projects/my-app", "")).toBe("projects/my-app/index.html");
  });
});

// ─── 2. Generate path ↔ verb path parity ────────────────────────────────

const PATH_FORMS = [
  "/home/nik/design-factory/projects/parity-app",
  "~/design-factory/projects/parity-app",
  "projects/parity-app",
];

function identifierOf(block: string): string {
  const m = block.match(/<artifact identifier="([^"]+)"/);
  if (!m) throw new Error(`no identifier in contract block:\n${block}`);
  return m[1];
}

describe("generate path and verb path agree on the artifact identifier", () => {
  for (const projectPath of PATH_FORMS) {
    it(`projectPath="${projectPath}"`, () => {
      // Verb path — artifactContractForCtx (anthropic = artifact channel).
      const verbCtx: ProjectContext = {
        projectId: "parity-app",
        projectPath,
        primaryFile: "index.html",
        mode: "hifi",
        conversationHistory: [],
        hasDesignSystem: false,
        providerId: "anthropic",
      };
      const verbBlock = artifactContractForCtx(verbCtx);
      expect(verbBlock).not.toBe("");

      // Generate path — composeSystemBlocks (same ctx, kind generate).
      const genBlocks = composeSystemBlocks(verbCtx, { kind: "generate", lang: "en" });
      const genContract = genBlocks.find((b) => b.id === "contract");
      expect(genContract).toBeTruthy();

      // Generate path via the pipeline's prepare() override branch.
      const input: UserTurnInput = {
        userMessage: "x",
        providerId: "anthropic",
        projectId: "parity-app",
        threadId: "main",
        context: { projectPath, primaryFile: "index.html" },
      };
      const prepared = prepare(input, { systemPromptOverride: "OVERRIDE." });

      const verbId = identifierOf(verbBlock);
      const genId = identifierOf(genContract!.content);
      const overrideId = identifierOf(prepared.systemPrompt);

      expect(genId).toBe(verbId);
      expect(overrideId).toBe(verbId);
      expect(verbId).toBe("projects/parity-app/index.html");
    });
  }
});

// ─── 3. Cross-layer: daemon normalization lands on the same file ────────

describe("daemon normalizeIdentifier accepts the emitted identifier 1:1", () => {
  it("identifier normalizes to projects/<slug>/<primaryFile> (no nesting)", () => {
    for (const projectPath of PATH_FORMS) {
      const id = toRepoRelativeArtifactPath(projectPath, "index.html");
      expect(normalizeIdentifier(id, "parity-app")).toBe("projects/parity-app/index.html");
    }
  });

  it("regression: the pre-fix absolute-path identifier nested under the project", () => {
    // What the generate path used to emit for an absolute projectPath —
    // proof of WHY the helper exists. The daemon prefixes any
    // non-projects/ identifier, producing a nested path ≠ the tool
    // channel's target.
    const legacyId = "/home/nik/design-factory/projects/parity-app/index.html".replace(
      /^~\/?/,
      "",
    );
    const normalized = normalizeIdentifier(legacyId, "parity-app");
    expect(normalized).toBe(
      "projects/parity-app/home/nik/design-factory/projects/parity-app/index.html",
    );
    expect(normalized).not.toBe("projects/parity-app/index.html");
  });
});
