#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
assert(pkg.license === "Apache-2.0", 'package.json license must be "Apache-2.0"');
assert(
  lock.packages?.[""]?.license === "Apache-2.0",
  'package-lock.json root license must be "Apache-2.0"',
);
assert(read("LICENSE").includes("Apache License"), "LICENSE must contain Apache License text");
assert(existsSync(join(root, "NOTICE")), "NOTICE must exist");
assert(existsSync(join(root, "SECURITY.md")), "SECURITY.md must exist");
assert(existsSync(join(root, "CODE_OF_CONDUCT.md")), "CODE_OF_CONDUCT.md must exist");
assert(existsSync(join(root, "CONTRIBUTING.md")), "CONTRIBUTING.md must exist");
assert(existsSync(join(root, "GOVERNANCE.md")), "GOVERNANCE.md must exist");
assert(existsSync(join(root, "SUPPORT.md")), "SUPPORT.md must exist");
assert(existsSync(join(root, "docs", "README.md")), "docs/README.md must exist");

if (failures.length) {
  console.error("public-files smoke: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("public-files smoke: PASS");
