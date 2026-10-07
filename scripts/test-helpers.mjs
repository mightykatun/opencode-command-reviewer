import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import inventory from "./helper-tests.json" with { type: "json" }

assert.ok(Array.isArray(inventory) && inventory.length > 0)
assert.equal(new Set(inventory).size, inventory.length, "Helper inventory must not contain duplicates")
const root = fileURLToPath(new URL("../", import.meta.url))
const files = inventory.map((file) => {
  assert.match(file, /^test\/[a-z0-9-]+\.test\.mjs$/, "Invalid pure-helper test path")
  assert.ok(!["test/smoke-runtime.test.mjs", "test/release-artifact-smoke.test.mjs", "test/npm-cli-smoke.test.mjs"].includes(file), "Host, built-package and actual npm CLI fixtures run separately")
  return fileURLToPath(new URL(`../${file}`, import.meta.url))
})
execFileSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" })
