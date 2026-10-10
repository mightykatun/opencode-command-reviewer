import assert from "node:assert/strict"
import { appendFile, readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

function parseVersion(version) {
  assert.equal(typeof version, "string", "Package version must be valid semantic versioning")
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  assert.ok(match && match[0] === version, "Package version must be valid semantic versioning")
  assert.ok(!match[4]?.split(".").some((part) => /^0\d+$/.test(part)), "Numeric prerelease identifiers cannot have leading zeros")
  return { core: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split(".") }
}

export function isPrerelease(version) {
  return parseVersion(version).prerelease !== undefined
}

/** npm 12 semver.clean must preserve the release identity, not normalize it to another version. */
export function npmReleaseVersion(version) {
  assert.equal(typeof version, "string", "Package version must be valid semantic versioning")
  assert.ok(version.length <= 256, "Release version exceeds npm SemVer bounds")
  const parsed = parseVersion(version)
  assert.ok(!version.includes("+"), "Release versions must be canonical npm versions without build metadata")
  assert.ok(parsed.core.every((part) => part <= BigInt(Number.MAX_SAFE_INTEGER)),
    "Release version exceeds npm SemVer bounds")
  return version
}

/** npm's manifest.tag can override --tag, and publishConfig can contain arbitrary npm options. */
export function validatePublicationPackage(pkg) {
  assert.ok(pkg && typeof pkg === "object" && !Array.isArray(pkg), "Invalid release package metadata")
  assert.equal(pkg.name, "opencode-reviewer", "Unexpected release package")
  npmReleaseVersion(pkg.version)
  assert.ok(!Object.hasOwn(pkg, "tag"), "Release package must not contain a top-level tag")
  assert.ok(pkg.publishConfig && typeof pkg.publishConfig === "object" && !Array.isArray(pkg.publishConfig), "Invalid publication config")
  assert.deepEqual(Object.keys(pkg.publishConfig).sort(), ["access", "registry"], "Publication config must contain only access and registry")
  assert.equal(pkg.publishConfig.access, "public", "Publication access must be public")
  assert.equal(pkg.publishConfig.registry, "https://registry.npmjs.org/", "Publication registry must be npm")
  return pkg
}

/** SemVer precedence ignores build metadata and retains arbitrary-size numeric identifiers. */
export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right)
  const compare = (x, y) => x < y ? -1 : x > y ? 1 : 0
  for (let i = 0; i < 3; i++) {
    const order = compare(a.core[i], b.core[i])
    if (order) return order
  }
  if (!a.prerelease || !b.prerelease) return compare(!a.prerelease, !b.prerelease)
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i]
    if (x === undefined || y === undefined) return compare(x !== undefined, y !== undefined)
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y)
    const order = numericX && numericY ? compare(BigInt(x), BigInt(y))
      : numericX !== numericY ? compare(!numericX, !numericY) : compare(x, y)
    if (order) return order
  }
  return 0
}

export const releaseChannel = (version) => isPrerelease(npmReleaseVersion(version)) ? "next" : "latest"

/** An exact owner is idempotent; a different build variant cannot replace equal precedence. */
export function canAdvanceChannel(version, current) {
  parseVersion(version)
  return current === undefined || version === current || compareVersions(version, current) > 0
}

export function publicationTag(version, tags) {
  assert.ok(tags && typeof tags === "object" && !Array.isArray(tags), "Registry returned invalid dist-tags")
  const channel = releaseChannel(version)
  if (tags[channel] !== undefined) npmReleaseVersion(tags[channel])
  return canAdvanceChannel(version, tags[channel]) ? channel : "archive"
}

export function releaseVersion(pkg, lock, tag) {
  validatePublicationPackage(pkg)
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
  assert.match(process.env.RELEASE_COMMIT ?? "", /^[a-f0-9]{40}$/, "Expected the verified tag commit")
  assert.match(process.env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9]\d*$/, "Expected the validation attempt")
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `version=${pkg.version}\ntag=${process.env.RELEASE_TAG}\ncommit=${process.env.RELEASE_COMMIT}\nvalidation_attempt=${process.env.GITHUB_RUN_ATTEMPT}\n`)
  console.log(`Verified ${process.env.RELEASE_TAG}: ${prerelease ? "prerelease (next)" : "stable (latest)"}`)
}
