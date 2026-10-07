import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { publishRelease } from "../scripts/publish-release.mjs"

const pkg = { name: "opencode-reviewer", version: "0.4.0" }
const bytes = Buffer.from("verified archive fixture")
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`

test("identical published archives are idempotent and never invoke npm", async () => {
  const result = await publishRelease("/tmp/verified.tgz", pkg, bytes, {
    fetcher: async (url) => {
      assert.equal(url, "https://registry.npmjs.org/opencode-reviewer/0.4.0")
      return Response.json({ dist: { integrity } })
    },
    run: () => assert.fail("must not republish an existing version"),
  })
  assert.equal(result, "existing")
})

test("mismatched archives and registry failures never publish", async () => {
  for (const response of [Response.json({ dist: { integrity: "different" } }), new Response(null, { status: 503 })]) {
    await assert.rejects(publishRelease("/tmp/verified.tgz", pkg, bytes, {
      fetcher: async () => response, run: () => assert.fail("must not publish"),
    }))
  }
  await assert.rejects(publishRelease("/tmp/verified.tgz", pkg, bytes, {
    fetcher: async () => { throw new Error("offline") }, run: () => assert.fail("must not publish"),
  }), /offline/)
})

test("new releases publish the existing archive, with stable/prerelease tags and provenance", async () => {
  for (const [version, prerelease, tag] of [["0.4.0", false, "latest"], ["0.5.0-beta.1", false, "next"], ["0.5.0", true, "next"], ["0.5.0+build-hash", false, "latest"]]) {
    let calls = 0
    assert.equal(await publishRelease("/tmp/verified.tgz", { ...pkg, version }, bytes, {
      prerelease, fetcher: async () => new Response(null, { status: 404 }),
      run: (command, args) => {
        calls++
        assert.equal(command, "npm")
        assert.deepEqual(args, ["publish", "/tmp/verified.tgz", "--ignore-scripts", "--access", "public", "--provenance", "--tag", tag, "--registry", "https://registry.npmjs.org/"])
      },
    }), "published")
    assert.equal(calls, 1)
  }
})
