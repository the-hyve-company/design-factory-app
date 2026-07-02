// Type declarations for static-p0-core.mjs — consumed by the TypeScript
// client wrapper (src/runtime/static-p0.ts). Keep in sync with the JSDoc
// typedefs in the .mjs implementation.

export declare const DEFAULT_BYTE_FLOOR: number;
export declare const JSON_BYTE_FLOOR: number;
export declare const BINARY_BYTE_FLOOR: number;

export interface StaticP0CoreInput {
  type: string;
  content: string;
  byteFloor?: number;
}

export interface StaticP0CorePass {
  ok: true;
  checks: string[];
}

export interface StaticP0CoreFail {
  ok: false;
  reason: string;
  details: string;
  failedChecks: string[];
}

export type StaticP0CoreResult = StaticP0CorePass | StaticP0CoreFail;

export declare function validateArtifactStaticP0Core(input: StaticP0CoreInput): StaticP0CoreResult;

export declare function parseJsGoalAware(
  content: string,
): { ok: true; goal: "script" | "module" } | { ok: false; error: string };
