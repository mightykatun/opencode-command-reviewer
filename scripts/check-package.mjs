import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"

execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" })
const digest = async () => createHash("sha256").update(await readFile("dist/tui.js")).digest("hex")
const first = await digest()
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" })
assert.equal(await digest(), first, "two builds must produce identical bundles")
const output = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }))
const manifest = JSON.parse(await readFile("package.json", "utf8"))
const lock = JSON.parse(await readFile("package-lock.json", "utf8"))
assert.equal(lock.name, manifest.name, "lockfile name must match package.json")
assert.equal(lock.packages[""].name, manifest.name, "lockfile root name must match package.json")
// npm <=11 returns an array; npm 12 keys results by package name.
const pack = Array.isArray(output) ? output[0] : output[manifest.name]
assert.ok(pack?.files, "npm pack must report package contents")
assert.equal(pack.name, manifest.name)
assert.equal(pack.version, manifest.version)
assert.equal(pack.filename, `${manifest.name}-${manifest.version}.tgz`)
const paths = pack.files.map((f) => f.path).sort()
assert.deepEqual(paths, ["README.md", "THIRD_PARTY_NOTICES.md", "dist/tui.js", "package.json"].sort())
console.log(`PASS: reproducible bundle SHA-256 ${first}; package contains exactly ${paths.length} intended files (${pack.unpackedSize} bytes unpacked).`)
