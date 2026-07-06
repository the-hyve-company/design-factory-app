#!/usr/bin/env node
import { runAllChecks } from "./public-files-smoke-lib.mjs";

const failures = runAllChecks(process.cwd());
if (failures.length) {
  console.error("public-files / IP gate: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("public-files / IP gate: PASS");
