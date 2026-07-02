// Type declarations for resolve-artifact-target.mjs — consumed by the
// TypeScript parity test (src/runtime/artifact-path-parity.test.ts).

export interface ResolveArtifactTargetTestInternals {
  normalizeIdentifier: (identifier: string, projectId: string) => string | null;
  roleFromPath: (normalizedPath: string, projectId: string) => string | null;
  inferTypeFromPath: (p: string) => string | null;
  previewableForType: (type: string) => boolean;
  isTypeRoleConsistent: (type: string, role: string) => boolean;
}

export declare function resolveArtifactTarget(input: unknown, projectsRoot: string): unknown;

export declare const __TEST_INTERNALS__: ResolveArtifactTargetTestInternals;
