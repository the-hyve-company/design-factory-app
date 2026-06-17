import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorScreen } from "./EditorScreen";
import { t } from "@/i18n";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(async () => {}),
  applyStyle: vi.fn(async () => {}),
  addComponent: vi.fn(async () => {}),
  runVerb: vi.fn(async () => {}),
  persistOrRecoverTurn: vi.fn(async () => ({ status: "saved" as const })),
  sendUserTurn: vi.fn(async () => ({
    messages: [{ text: "Generated public launch page", tools: [] }],
    duration_ms: 42,
  })),
}));

vi.mock("@/hooks/useClaude", () => ({
  useClaude: () => ({
    output: "",
    status: "idle",
    error: null,
    subAgents: [],
    streamLabel: "thinking...",
    elapsedMs: 0,
    ttftMs: null,
    tokens: 0,
    modelName: null,
    usage: null,
    result: null,
    tools: [],
    generate: mocks.generate,
    applyStyle: mocks.applyStyle,
    addComponent: mocks.addComponent,
    runVerb: mocks.runVerb,
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSkillRegistry", () => ({
  useSkillRegistry: () => ({
    registry: null,
    skills: [
      {
        id: "df:skills/smoke/SKILL.md",
        name: "Smoke Skill",
        trigger: "/smoke",
        description: "A test skill",
        body: "Use this skill for smoke coverage.",
        source: "df",
        path: "skills/smoke/SKILL.md",
        requires: [],
        body_hash: "abc123",
      },
    ],
    bySource: { df: [], project: [], global: [], builtin: [] },
    byTrigger: new Map(),
    isScanning: false,
    lastScanAt: Date.now(),
    error: null,
    truncated: false,
    rescan: vi.fn(async () => {}),
    lookup: vi.fn(() => ({ matches: [], resolved: null, hasCollision: false })),
  }),
}));

vi.mock("@/runtime/verbs/registry", async () => {
  const actual = await vi.importActual<typeof import("@/runtime/verbs/registry")>(
    "@/runtime/verbs/registry",
  );
  return {
    ...actual,
    loadAllVerbs: vi.fn(async () => [
      {
        id: "polish",
        label: "Polish",
        description: "Tighten visual hierarchy",
        category: "refine",
        hue: "warm-gold",
        modifiesHtml: true,
        icon: "sparkles",
        systemPrompt: "Polish the current design.",
        source: "builtin",
      },
    ]),
    matchVerb: vi.fn(() => null),
  };
});

vi.mock("@/lib/chat-persist", () => ({
  persistOrRecoverTurn: mocks.persistOrRecoverTurn,
}));

vi.mock("@/lib/provider-sessions", () => ({
  EMPTY_PROVIDER_SESSIONS: { version: 1, sessions: {} },
  readProviderSessions: vi.fn(async () => ({ version: 1, sessions: {} })),
  upsertProviderSession: vi.fn(async () => ({ version: 1, sessions: {} })),
}));

vi.mock("@/runtime/send-user-turn", () => ({
  isTurnPipelineV2Enabled: vi.fn(() => true),
  sendUserTurn: mocks.sendUserTurn,
}));

vi.mock("@/lib/turn-recorder", () => ({
  startTurn: vi.fn(),
  endTurn: vi.fn(() => null),
  record: vi.fn(),
  attachProjectSlug: vi.fn(),
  getCurrentTurn: vi.fn(() => null),
  getRecentTurns: vi.fn(() => []),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock("@/components/FileManager", () => ({
  FileManager: () => <div data-testid="files-surface">Files surface</div>,
}));

vi.mock("@/components/AgentPicker", () => ({
  AgentPicker: () => <button type="button">Claude</button>,
}));

vi.mock("@/components/ChatHistoryDropdown", () => ({
  ChatHistoryDropdown: () => <button type="button">main</button>,
}));

vi.mock("@/components/NewProjectFormSkeu", () => ({
  ModelRocker: () => <button type="button">model</button>,
}));

vi.mock("@/lib/claude-bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/claude-bridge")>("@/lib/claude-bridge");
  return {
    ...actual,
    refreshBridgeStatus: vi.fn(async () => ({
      available: true,
      url: "http://127.0.0.1:1421",
      checkedAt: Date.now(),
    })),
    readGlobalConfig: vi.fn(async () => ({})),
    writeGlobalConfig: vi.fn(async () => ({})),
    readProjectMeta: vi.fn(async () => null),
    writeProjectMeta: vi.fn(async () => true),
    listProjectVersions: vi.fn(async () => []),
    saveProjectVersion: vi.fn(async () => true),
    deleteProjectVersion: vi.fn(async () => true),
    listCustomCommands: vi.fn(async () => []),
    readChatTurns: vi.fn(async () => ({ turns: [] })),
    readChatMessages: vi.fn(async () => []),
    readChatSnapshot: vi.fn(async () => null),
    writeChatSnapshot: vi.fn(async () => true),
    appendChatTurn: vi.fn(async () => true),
    fetchWorkspaceInfo: vi.fn(async () => ({
      repoRoot: "/tmp/df",
      projectsDir: "/tmp/df/projects",
    })),
    readFileViaBridge: vi.fn(async () => null),
    listFolder: vi.fn(async () => ({ path: "/tmp/df-smoke", entries: [] })),
    pathExists: vi.fn(async () => true),
    listDesignSystemsFromFilesystem: vi.fn(async () => []),
  };
});

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.selectionStart = value.length;
  textarea.selectionEnd = value.length;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }
  throw lastError;
}

describe("EditorScreen happy path", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 404 })),
    );
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("mounts the editor, renders slash suggestions, and dispatches a first prompt", async () => {
    await act(async () => {
      root.render(
        <EditorScreen
          projectId="project-smoke"
          projectName="Smoke Project"
          projectPath="/tmp/df-smoke"
          mode="hifi"
          onHome={() => {}}
        />,
      );
    });

    expect(host.querySelector("[data-testid='files-surface']")).toBeTruthy();
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea.chat-input-field");
    expect(textarea).toBeTruthy();
    expect(textarea?.placeholder).toBe(t("editor.input.placeholder.create"));

    await act(async () => {
      changeTextarea(textarea!, "/");
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Polish");
      expect(document.body.textContent).toContain("Smoke Skill");
    });

    await act(async () => {
      changeTextarea(textarea!, "Make a precise public launch page");
      host
        .querySelector<HTMLButtonElement>("button.chat-input-send")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(host.textContent).toContain("Make a precise public launch page");
      expect(mocks.persistOrRecoverTurn).toHaveBeenCalled();
      expect(mocks.sendUserTurn).toHaveBeenCalledTimes(1);
    });
    const [sendInput] = mocks.sendUserTurn.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(sendInput).toMatchObject({
      userMessage: "Make a precise public launch page",
      providerId: "claude",
      projectId: "project-smoke",
      threadId: "main",
    });
    expect(host.textContent).toContain("Generated public launch page");
  });
});
