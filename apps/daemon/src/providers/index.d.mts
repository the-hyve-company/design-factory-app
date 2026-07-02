// Type declarations for providers/index.mjs (the daemon registry) —
// consumed by the TypeScript parity test
// (src/providers/capability-parity.test.ts).

export interface DaemonProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  multimodal: boolean;
  /** Same concept as the frontend `supportsResume` (WS3 unify-capability-shape). */
  supportsResume: boolean;
  mcp: boolean;
  fileWrite: "tool" | "artifact";
}

export interface DaemonProviderAdapter {
  id: string;
  label: string;
  capabilities: DaemonProviderCapabilities;
  readiness?: "stable" | "beta" | "experimental";
  stream: (req: unknown, res: unknown, deps: unknown) => Promise<void>;
  once: (req: unknown, res: unknown, deps: unknown) => Promise<void>;
}

export declare const PROVIDERS: Record<string, DaemonProviderAdapter>;
export declare function getProvider(id: string): DaemonProviderAdapter | null;
export declare function listProviders(): DaemonProviderAdapter[];
export declare function describeProvider(p: DaemonProviderAdapter): {
  id: string;
  label: string;
  capabilities: DaemonProviderCapabilities;
  readiness: "stable" | "beta" | "experimental";
};
