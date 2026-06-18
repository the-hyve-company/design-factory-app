import { describe, it, expect } from "vitest";
import { shouldAppendArtifactContract, buildArtifactContractBlock } from "./output-contract";

describe("shouldAppendArtifactContract — capability gate", () => {
  it("returns false for tool-driven providers (Claude shape)", () => {
    expect(
      shouldAppendArtifactContract({
        capabilities: {
          tools: true,
          mcp: true,
          nativeSkills: true,
          nativeAgents: true,
          streamJson: true,
          fileWrite: "tool",
        },
      }),
    ).toBe(false);
  });

  it("returns true for artifact-driven providers (Gemini/Anthropic API/etc.)", () => {
    expect(
      shouldAppendArtifactContract({
        capabilities: {
          tools: false,
          mcp: false,
          nativeSkills: false,
          nativeAgents: false,
          streamJson: true,
          fileWrite: "artifact",
        },
      }),
    ).toBe(true);
  });
});

describe("buildArtifactContractBlock", () => {
  it("returns empty string when capability is tool-driven", () => {
    expect(buildArtifactContractBlock({ fileWrite: "tool", filePath: "projects/x/x.html" })).toBe(
      "",
    );
  });

  it("includes the file path, type, and title in the canonical block", () => {
    const out = buildArtifactContractBlock({
      fileWrite: "artifact",
      filePath: "projects/gooey/index.html",
      projectName: "Gooey",
    });
    expect(out).toContain("OUTPUT CONTRACT");
    expect(out).toContain('<artifact identifier="projects/gooey/index.html"');
    expect(out).toContain('type="text/html"');
    expect(out).toContain('title="Gooey"');
    expect(out).toContain("EXACTLY ONE <artifact> block");
    expect(out).toContain("LAST thing in your reply");
  });

  it("falls back to filename stem when projectName is omitted", () => {
    const out = buildArtifactContractBlock({
      fileWrite: "artifact",
      filePath: "projects/abc/abc.html",
    });
    expect(out).toContain('title="abc"');
  });

  it("respects custom contentType for non-HTML artifacts", () => {
    const out = buildArtifactContractBlock({
      fileWrite: "artifact",
      filePath: "projects/x/notes.md",
      contentType: "text/markdown",
      projectName: "Notes",
    });
    expect(out).toContain('type="text/markdown"');
  });
});
