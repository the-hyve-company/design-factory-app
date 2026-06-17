// regression tests — chat-sanitizer covers (user
// report 2026-05-07): "respostas do assistente estao sumindo do chat".
//
// Reference: see also `docs/agent-contract.md` for the output contract
// that drives why these invariants matter.

import { describe, it, expect } from "vitest";
import { sanitizeMessages, type SanitizableChatMessage } from "./chat-sanitizer";

// Helper to make test data terse
function msg(
  role: "user" | "assistant",
  text: string,
  extras: Partial<SanitizableChatMessage> = {},
): SanitizableChatMessage {
  return { role, text, ...extras };
}

describe("sanitizeMessages — regressions", () => {
  it("keeps empty assistant message with [empty response] when provider metadata exists", () => {
    // Symptom: providers (codex/cursor/qwen/copilot) sometimes complete
    // without firing onText OR a Write tool — the persisted turn ends up
    // with text="" but provider/model fields populated. Old sanitizer
    // dropped those entirely, user saw "my message but no reply".
    const input: SanitizableChatMessage[] = [
      msg("user", "hello"),
      msg("assistant", "", { provider: "codex", model: "gpt-5", turn_id: "t1" }),
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages).toHaveLength(2);
    expect(messages[1].text).toBe("[empty response]");
    expect(messages[1].provider).toBe("codex");
    expect(messages[1].model).toBe("gpt-5");
  });

  it("keeps empty assistant when only provider exists (no model)", () => {
    const input: SanitizableChatMessage[] = [
      msg("assistant", "", { provider: "claude", turn_id: "t1" }),
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("[empty response]");
  });

  it("keeps empty assistant when only model exists (no provider)", () => {
    const input: SanitizableChatMessage[] = [
      msg("assistant", "", { model: "claude-opus-4-7", turn_id: "t1" }),
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("[empty response]");
  });

  it("DROPS empty assistant when no provider/model/tools/isDesign — truly broken placeholder", () => {
    // This is the crashed-stream case: a placeholder that never
    // received any signal from the provider. Drop it; it's noise.
    const input: SanitizableChatMessage[] = [
      msg("user", "hi"),
      msg("assistant", "", { turn_id: "t1" }),
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("keeps empty assistant when tools fired (real work happened)", () => {
    const input: SanitizableChatMessage[] = [
      msg("assistant", "", { tools: [{ id: "t", name: "Write" }], turn_id: "t1" }),
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages).toHaveLength(1);
    // Text stays empty — it's not the empty-marker case (tools exist)
    expect(messages[0].text).toBe("");
  });

  it("keeps empty assistant when isDesign flag is set", () => {
    const input: SanitizableChatMessage[] = [
      msg("assistant", "", { isDesign: true, turn_id: "t1" }),
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].isDesign).toBe(true);
  });

  it("dedups by (turn_id, role, first 60 chars)", () => {
    const input: SanitizableChatMessage[] = [
      msg("user", "what is the meaning of life", { turn_id: "t1" }),
      msg("user", "what is the meaning of life", { turn_id: "t1" }), // exact dup
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(1);
    expect(messages).toHaveLength(1);
  });

  it("does NOT dedup messages with different turn_ids", () => {
    const input: SanitizableChatMessage[] = [
      msg("user", "tell me about cats", { turn_id: "t1" }),
      msg("user", "tell me about cats", { turn_id: "t2" }), // different turn → not a dup
    ];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages).toHaveLength(2);
  });

  it("collapses leaked HTML (>8KB starting with doctype) into placeholder", () => {
    const leakedHtml = "<!DOCTYPE html><html>" + "x".repeat(9000);
    const input: SanitizableChatMessage[] = [msg("assistant", leakedHtml, { turn_id: "t1" })];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toMatch(/^\[Leaked HTML output collapsed/);
    expect(messages[0].text).toMatch(/KB\. The Write tool wasn't used/);
  });

  it("collapses leaked HTML starting with ```html fence", () => {
    const leaked = "```html\n<!DOCTYPE html>\n" + "y".repeat(9000);
    const input: SanitizableChatMessage[] = [msg("assistant", leaked, { turn_id: "t1" })];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(1);
    expect(messages[0].text).toMatch(/^\[Leaked HTML output collapsed/);
  });

  it("does NOT collapse normal long-but-non-HTML assistant text", () => {
    // 9000 chars of normal prose — keep as-is.
    const longProse = "The quick brown fox ".repeat(500);
    const input: SanitizableChatMessage[] = [msg("assistant", longProse, { turn_id: "t1" })];
    const { messages, cleaned } = sanitizeMessages(input);

    expect(cleaned).toBe(0);
    expect(messages[0].text).toBe(longProse);
  });

  it("preserves message order", () => {
    const input: SanitizableChatMessage[] = [
      msg("user", "1", { turn_id: "a" }),
      msg("assistant", "1-reply", { turn_id: "a" }),
      msg("user", "2", { turn_id: "b" }),
      msg("assistant", "2-reply", { turn_id: "b" }),
    ];
    const { messages } = sanitizeMessages(input);

    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.text)).toEqual(["1", "1-reply", "2", "2-reply"]);
  });
});
