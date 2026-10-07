import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"

export const archiveIntegrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`

// Cache-Control alone did not bypass cached 404s during the first automated release.
export function freshRegistryURL(url) {
  const fresh = new URL(url)
  assert.equal(fresh.origin, "https://registry.npmjs.org", "Expected the npm registry")
  fresh.searchParams.set("release_check", randomUUID())
  return fresh.href
}

class Pending extends Error {}

/** npm may accept an upload before its version, dist-tag and archive are available.
 * Retry reads only. Never retry the publication itself.
 */
export async function verifyPublication(pkg, bytes, tag, {
  fetcher = fetch, sleep = setTimeout, now = () => performance.now(),
  timeoutMs = 600000, intervalMs = 10000, log = console.log,
} = {}) {
  const end = now() + timeoutMs
  const integrity = archiveIntegrity(bytes)
  const root = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`
  let reason = "version metadata unavailable"
  async function get(url) {
    if (now() >= end) throw new Pending("registry deadline elapsed")
    const fresh = freshRegistryURL(url)
    let response
    try {
      response = await fetcher(fresh, {
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(15000, end - now())))),
      })
    } catch { throw new Pending("registry request failed") }
    if (!response.ok) {
      try { await response.body?.cancel() } catch { /* No response body is needed. */ }
      if ([404, 408, 429].includes(response.status) || response.status >= 500) {
        throw new Pending(`registry HTTP ${response.status}`)
      }
      throw new Error(`Registry verification failed: HTTP ${response.status}`)
    }
    return response
  }
  while (now() < end) {
    try {
      const metadata = await (await get(`${root}/${encodeURIComponent(pkg.version)}`)).json()
      assert.equal(metadata.version, pkg.version, "Registry returned a different version")
      assert.equal(metadata.dist?.integrity, integrity, "Published archive integrity differs from the verified build")
      const tags = await (await get(`https://registry.npmjs.org/-/package/${encodeURIComponent(pkg.name)}/dist-tags`)).json()
      if (tags[tag] !== pkg.version) throw new Pending(`${tag} has not reached ${pkg.version}`)
      assert.equal(typeof metadata.dist.tarball, "string", "Registry returned no archive URL")
      const archive = Buffer.from(await (await get(metadata.dist.tarball)).arrayBuffer())
      assert.equal(archive.length, bytes.length, "Published archive size differs from the verified build")
      assert.equal(archiveIntegrity(archive), integrity, "Downloaded npm archive differs from the verified build")
      assert.ok(now() < end, "npm publication verification exceeded its deadline")
      log(`Verified ${pkg.name}@${pkg.version} on npm (${tag}); archive integrity matches`)
      return
    } catch (error) {
      if (!(error instanceof Pending)) throw error
      reason = error.message
    }
    const remaining = end - now()
    if (remaining <= 0) break
    log(`Waiting for npm: ${reason}. Checking again in ${Math.min(intervalMs, remaining) / 1000}s.`)
    await sleep(Math.min(intervalMs, remaining))
  }
  throw new Error(`npm accepted the upload but publication could not be verified within ${timeoutMs / 1000}s: ${reason}. Check npm before retrying; do not republish or change the version just to bypass processing.`)
}
