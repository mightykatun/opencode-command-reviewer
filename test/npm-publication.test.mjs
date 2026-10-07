import { test } from "node:test"
import assert from "node:assert/strict"
import { archiveIntegrity, verifyPublication } from "../scripts/npm-publication.mjs"
import { publishRelease } from "../scripts/publish-release.mjs"

const pkg = { name: "opencode-reviewer", version: "0.4.1" }
const bytes = Buffer.from("verified archive")
const metadata = { ...pkg, dist: {
  integrity: archiveIntegrity(bytes),
  tarball: "https://registry.npmjs.org/opencode-reviewer/-/opencode-reviewer-0.4.1.tgz",
} }
const versionPath = "/opencode-reviewer/0.4.1"
const tagsPath = "/-/package/opencode-reviewer/dist-tags"
const ready = (url, tag = "latest") => {
  const pathname = new URL(url).pathname
  return pathname === versionPath ? Response.json(metadata)
    : pathname === tagsPath ? Response.json({ [tag]: pkg.version })
    : new Response(bytes)
}
function clock() {
  let at = 0
  const messages = []
  return { now: () => at, sleep: async (ms) => { at += ms }, log: (s) => messages.push(s), messages, timeoutMs: 100, intervalMs: 10 }
}

test("accepted publication waits for metadata, dist-tag and archive without republishing", async () => {
  let publishes = 0, polls = 0
  const options = clock(), urls = new Set()
  assert.equal(await publishRelease("/tmp/verified.tgz", pkg, bytes, {
    fetcher: async () => new Response(null, { status: 404 }),
    run: () => { publishes++ },
  }), "submitted")
  await verifyPublication(pkg, bytes, "latest", { ...options,
    fetcher: async (url, init) => {
      assert.equal(init.headers["cache-control"], "no-cache")
      assert.ok(init.signal instanceof AbortSignal)
      assert.ok(new URL(url).searchParams.get("release_check"))
      assert.ok(!urls.has(url), "every poll must bypass negative registry caches")
      urls.add(url)
      const pathname = new URL(url).pathname
      if (pathname === versionPath && ++polls === 1) return new Response(null, { status: 404 })
      if (pathname === tagsPath && polls === 2) return Response.json({ latest: "0.4.0" })
      if (pathname.endsWith(".tgz") && polls === 3) return new Response(null, { status: 404 })
      return ready(url)
    },
  })
  assert.equal(publishes, 1)
  assert.equal(polls, 4)
  assert.equal(options.now(), 30)
  assert.match(options.messages.at(-1), /Verified.*archive integrity matches/)
})

test("temporary registry failures retry only reads within the deadline", async () => {
  for (const status of [404, 408, 429, 500, 503, "network"]) {
    const options = clock()
    let calls = 0
    await verifyPublication(pkg, bytes, "latest", { ...options,
      fetcher: async (url) => {
        if (++calls === 1) {
          if (status === "network") throw new Error("offline")
          return new Response(null, { status })
        }
        return ready(url)
      },
    })
    assert.equal(options.now(), 10)
    assert.equal(calls, 4)
  }
})

test("prerelease verification requires next rather than latest", async () => {
  await verifyPublication(pkg, bytes, "next", { ...clock(), fetcher: async (url) => ready(url, "next") })
})

test("verification fails promptly on authentication, metadata or archive mismatch", async () => {
  for (const bad of [
    new Response(null, { status: 403 }),
    Response.json({ ...metadata, version: "0.4.0" }),
    Response.json({ ...metadata, dist: { ...metadata.dist, integrity: "different" } }),
  ]) {
    const options = clock()
    await assert.rejects(verifyPublication(pkg, bytes, "latest", { ...options, fetcher: async () => bad }))
    assert.equal(options.now(), 0)
  }
  for (const archive of [Buffer.from("short"), Buffer.alloc(bytes.length)]) {
    await assert.rejects(verifyPublication(pkg, bytes, "latest", { ...clock(),
      fetcher: async (url) => new URL(url).pathname.endsWith(".tgz") ? new Response(archive) : ready(url),
    }), /archive.*differs/)
  }
})

test("archive verification never sends a registry request to another origin", async () => {
  let calls = 0
  await assert.rejects(verifyPublication(pkg, bytes, "latest", { ...clock(),
    fetcher: async (url) => {
      calls++
      return new URL(url).pathname === versionPath
        ? Response.json({ ...metadata, dist: { ...metadata.dist, tarball: "https://elsewhere.test/file.tgz" } })
        : ready(url)
    },
  }), /Expected the npm registry/)
  assert.equal(calls, 2)
})

test("persistent processing ends with an explicit timeout, not success", async () => {
  const options = clock()
  let calls = 0
  await assert.rejects(verifyPublication(pkg, bytes, "latest", { ...options, timeoutMs: 25,
    fetcher: async () => { calls++; return new Response(null, { status: 404 }) },
  }), /publication could not be verified.*do not republish/)
  assert.equal(options.now(), 25)
  assert.equal(calls, 3)
  assert.ok(options.messages.every((message) => !message.startsWith("Verified")))
})
