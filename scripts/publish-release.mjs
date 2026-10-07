import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { isPrerelease } from "./release-version.mjs"

// Publish the same verified bytes attached to GitHub. Existing versions are immutable:
// reruns (or the authenticated first-publication bootstrap) must match exactly.
export async function publishRelease(tarball, pkg, bytes, {
  fetcher = fetch, run = execFileSync, prerelease = process.env.RELEASE_PRERELEASE === "true",
} = {}) {
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000) })
  if (response.ok) {
    const existing = await response.json()
    assert.equal(existing.dist?.integrity, integrity, "Published version differs from this archive; publish a new version")
    console.log(`${pkg.name}@${pkg.version} already published with identical archive integrity`)
    return "existing"
  }
  assert.equal(response.status, 404, `Registry lookup failed: HTTP ${response.status}`)
  const tag = prerelease || isPrerelease(pkg.version) ? "next" : "latest"
  run("npm", ["publish", tarball, "--ignore-scripts", "--access", "public",
    "--provenance", "--tag", tag, "--registry", "https://registry.npmjs.org/"], { stdio: "inherit" })
  return "published"
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const tarball = process.argv[2]
  assert.ok(tarball && process.argv.length === 3, "Expected one verified package archive")
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  await publishRelease(tarball, pkg, await readFile(tarball))
}
