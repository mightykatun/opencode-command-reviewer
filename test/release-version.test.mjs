import { test } from "node:test"
import assert from "node:assert/strict"
import { releaseVersion } from "../scripts/release-version.mjs"

const manifests = (version) => [{ version }, { version, packages: { "": { version } } }, `v${version}`]

test("release classification separates prereleases from build metadata", () => {
  for (const [version, prerelease] of [["0.4.1", false], ["1.0.0-rc.1", true], ["1.0.0-beta", true], ["1.0.0+build-hash", false], ["1.0.0-0+build", true]]) {
    assert.deepEqual(releaseVersion(...manifests(version)), { prerelease })
  }
})

test("release validation refuses mismatched tags and lockfile versions", () => {
  const [pkg, lock] = manifests("0.4.1")
  for (const tag of [undefined, "0.4.1", "v0.4.0", "refs/heads/main", "v0.4.1\ninjected=true"]) {
    assert.throws(() => releaseVersion(pkg, lock, tag), /Release tag/)
  }
  assert.throws(() => releaseVersion(pkg, { ...lock, version: "0.4.0" }, "v0.4.1"), /Lockfile version/)
  assert.throws(() => releaseVersion(pkg, { ...lock, packages: { "": { version: "0.4.0" } } }, "v0.4.1"), /Lockfile root/)
})

test("release validation rejects malformed semantic versions", () => {
  for (const version of ["latest", "1.0", "01.0.0", "1.0.0-01", "1.0.0-alpha..1", "1.0.0-alpha_1", "1.0.0+", "1.0.0\n"]) {
    assert.throws(() => releaseVersion(...manifests(version)))
  }
})
