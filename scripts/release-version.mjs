import assert from "node:assert/strict"
import { appendFile, readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

export function isPrerelease(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  assert.ok(match && match[0] === version, "Package version must be valid semantic versioning")
  assert.ok(!match[4]?.split(".").some((part) => /^0\d+$/.test(part)), "Numeric prerelease identifiers cannot have leading zeros")
  return match[4] !== undefined
}

export function releaseVersion(pkg, lock, tag) {
  const prerelease = isPrerelease(pkg.version)
  assert.equal(tag, `v${pkg.version}`, "Release tag must match v<package.json version>")
  assert.equal(lock.version, pkg.version, "Lockfile version must match package.json")
  assert.equal(lock.packages[""].version, pkg.version, "Lockfile root version must match package.json")
  return { prerelease }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pkg = JSON.parse(await readFile("package.json", "utf8"))
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"))
  const { prerelease } = releaseVersion(pkg, lock, process.env.RELEASE_TAG)
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `prerelease=${prerelease}\n`)
  console.log(`Verified ${process.env.RELEASE_TAG}: ${prerelease ? "prerelease (next)" : "stable (latest)"}`)
}
