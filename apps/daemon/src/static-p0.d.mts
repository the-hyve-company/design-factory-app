// Type declarations for static-p0.mjs — consumed by the TypeScript parity
// test (src/runtime/static-p0-parity.test.ts).

export { DEFAULT_BYTE_FLOOR, JSON_BYTE_FLOOR, BINARY_BYTE_FLOOR } from "./lib/static-p0-core.mjs";
import type { StaticP0CoreInput, StaticP0CoreResult } from "./lib/static-p0-core.mjs";

export declare function validateArtifactStaticP0Full(input: StaticP0CoreInput): StaticP0CoreResult;
