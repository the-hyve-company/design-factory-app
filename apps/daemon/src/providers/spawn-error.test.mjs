import { describe, it, expect } from "vitest";
import { spawnErrorMessage } from "./spawn-error.mjs";

describe("spawnErrorMessage", () => {
  it("returns an actionable hint when the binary is not on PATH (ENOENT)", () => {
    const msg = spawnErrorMessage(
      Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }),
      "claude",
      "Claude Code",
    );
    expect(msg).toMatch(/Claude Code CLI not found/);
    expect(msg).toMatch(/"claude"/);
    expect(msg).toMatch(/DF_CLAUDE_BIN/);
    // Mac founders see a narrower PATH than their shell when launched
    // from a bundle. Mention it so they know where to look.
    expect(msg).toMatch(/macOS/i);
  });

  it("flags non-executable binaries (EACCES) with a chmod hint", () => {
    const msg = spawnErrorMessage(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
      "/usr/local/bin/claude",
      "Claude Code",
    );
    expect(msg).toMatch(/not executable/);
    expect(msg).toMatch(/chmod \+x/);
  });

  it("falls back to the raw error message for unknown codes", () => {
    const msg = spawnErrorMessage(
      Object.assign(new Error("E2BIG: arg list too long"), { code: "E2BIG" }),
      "claude",
      "Claude Code",
    );
    expect(msg).toMatch(/Claude Code spawn failed/);
    expect(msg).toMatch(/E2BIG/);
  });

  it("uses the binary name when no label is provided", () => {
    const msg = spawnErrorMessage(
      Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
      "kimi",
    );
    expect(msg).toMatch(/^kimi CLI not found/);
  });

  it("derives the env var name from non-alphanumeric binary names", () => {
    // Defensive: if the bin contains hyphens or spaces, the env var name
    // should still be a valid identifier (uppercase + underscores only).
    const msg = spawnErrorMessage(
      Object.assign(new Error(""), { code: "ENOENT" }),
      "claude-code",
      "Claude Code",
    );
    expect(msg).toMatch(/DF_CLAUDE_CODE_BIN/);
  });
});
