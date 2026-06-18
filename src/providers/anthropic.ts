import { streamAnthropic, anthropicOnce, getAnthropicTokenState } from "@/lib/anthropic-bridge";
import type { LLMProvider } from "./types";

// Anthropic API direct — BYOK fallback. The user pastes their API key
// into Settings; daemon persists at ~/.design-factory/anthropic.json (chmod
// 600). Used when Claude Code CLI isn't installed or when the user
// wants to bypass the CLI for whatever reason (debugging, alternate model
// targeting, etc).
//
// Capabilities are deliberately minimal: no tool execution because the
// daemon doesn't loop on tool_use → tool_result for this path. If you need
// agentic behavior, install the Claude Code CLI.

export const anthropicProvider: LLMProvider = {
  meta: {
    id: "anthropic",
    label: "Anthropic API",
    blurb: "Direct API access (BYOK). No CLI required, but no tool loop.",
    binary: "(api)",
  },
  capabilities: {
    tools: false,
    mcp: false,
    nativeSkills: false,
    nativeAgents: false,
    streamJson: true,
    // Anthropic API direct is text-only (no tool loop in the
    // daemon's pipeAnthropicStream today). Runtime parses `<artifact>`
    // and writes via the daemon. Artifact-driven channel.
    fileWrite: "artifact",
    // Anthropic API direct is stateless per-call. No session resume.
    // always sends the canonical handoff preamble.
    supportsResume: false,
  },
  stream: streamAnthropic,
  once: anthropicOnce,
  async status() {
    const state = await getAnthropicTokenState().catch(() => ({ tokenSet: false, source: null }));
    if (!state.tokenSet) {
      return {
        status: "needs-auth",
        version: null,
        detail: "no API key — set in Settings or export ANTHROPIC_API_KEY",
      };
    }
    return { status: "connected", version: state.source === "env" ? "env" : "saved" };
  },
};
