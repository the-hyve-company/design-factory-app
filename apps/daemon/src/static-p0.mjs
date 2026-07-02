// static-p0.mjs — daemon-side Static P0 gate.
//
// The SERVER half of the type-aware Static P0 gate, running inside the
// daemon's `writeArtifactSafely()` BEFORE the atomic rename so a broken
// artifact never replaces a working one.
//
// Since the WS1 `craft-net-shared-core` refactor this file is a thin
// delegator: the actual rule set lives in `lib/static-p0-core.mjs`, the
// ONE DOM-free implementation shared with the client pipeline
// (src/runtime/static-p0.ts wraps the same core and layers DOM extras).
// The two sides used to be hand-mirrored and drifted — the daemon
// skipped UTF-8 well-formedness and passed head-only documents. Verdict
// parity is now locked by src/runtime/static-p0-parity.test.ts.
//
// Returns `{ ok: true, checks: [...] }` on pass, or
// `{ ok: false, reason, details, failedChecks: [...] }` on fail.

import { validateArtifactStaticP0Core } from "./lib/static-p0-core.mjs";

export { DEFAULT_BYTE_FLOOR, JSON_BYTE_FLOOR, BINARY_BYTE_FLOOR } from "./lib/static-p0-core.mjs";

/**
 * @param {{ type: string, content: string, byteFloor?: number }} input
 * @returns {import("./lib/static-p0-core.mjs").StaticP0CoreResult}
 */
export function validateArtifactStaticP0Full({ type, content, byteFloor }) {
  return validateArtifactStaticP0Core({ type, content, byteFloor });
}
