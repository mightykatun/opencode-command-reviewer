import { test } from "node:test"
import assert from "node:assert/strict"
import { canAdvanceChannel, compareVersions, isPrerelease, npmReleaseVersion, publicationTag, releaseChannel, releaseVersion } from "../scripts/release-version.mjs"
import { githubRelease } from "../scripts/github-release.mjs"
import { fixturePackage } from "./release-fixture.mjs"

const manifests = (version) => [fixturePackage(version), { version, packages: { "": { version } } }, `v${version}`]

test("canonical release classification supports stable and prerelease identities", () => {
  for (const [version, prerelease] of [["0.4.1", false], ["1.0.0-rc.1", true], ["1.0.0-beta", true], ["1.0.0-0", true]]) {
    assert.deepEqual(releaseVersion(...manifests(version)), { prerelease })
  }
})

test("release identities reject npm normalization and bounds while general SemVer helpers retain metadata support", () => {
  assert.equal(isPrerelease("1.0.0+build"), false)
  assert.equal(isPrerelease("1.0.0-rc.1+build"), true)
  for (const version of ["1.0.0+build", "1.0.0-beta.1+build"]) {
    assert.throws(() => releaseVersion(...manifests(version)), /canonical npm versions without build metadata/)
    assert.throws(() => releaseChannel(version), /build metadata/)
  }
  for (const version of ["9007199254740992.0.0", "1.9007199254740992.0", "1.0.9007199254740992", `1.0.0-${"a".repeat(251)}`]) {
    assert.throws(() => npmReleaseVersion(version), /npm SemVer bounds/)
  }
  assert.equal(npmReleaseVersion("9007199254740991.0.0"), "9007199254740991.0.0")
  assert.equal(npmReleaseVersion("1.0.0-beta.9007199254740993"), "1.0.0-beta.9007199254740993")
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

test("SemVer precedence follows numeric, prerelease and build-metadata rules without precision loss", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2",
    "1.0.0-beta.10", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "1.9.0", "1.10.0", "2.0.0"]
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1)
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1)
  }
  for (const [left, right] of [
    ["1.0.0", "1.0.0+build"], ["1.0.0+first", "1.0.0+second"],
    ["1.0.0-beta+first", "1.0.0-beta+second"], ["1.0.0-0", "1.0.0-0"],
  ]) assert.equal(compareVersions(left, right), 0)
  assert.equal(compareVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1)
  assert.equal(compareVersions("1.0.0-beta.9007199254740993", "1.0.0-beta.9007199254740992"), 1)
  assert.equal(compareVersions("1.0.0-1", "1.0.0-a"), -1)
  assert.throws(() => compareVersions("1.0.0", "1.0.0-01"))
})

test("channel eligibility is forward-only for canonical identities", () => {
  assert.equal(releaseChannel("1.0.0"), "latest")
  assert.equal(releaseChannel("1.0.0-beta"), "next")
  assert.equal(canAdvanceChannel("1.0.0", undefined), true)
  assert.equal(canAdvanceChannel("1.1.0", "1.0.0"), true)
  assert.equal(canAdvanceChannel("1.0.0", "1.0.0"), true)
  assert.equal(canAdvanceChannel("1.0.0", "1.1.0"), false)
  assert.equal(canAdvanceChannel("1.0.0+second", "1.0.0+first"), false)
  assert.equal(publicationTag("1.0.0-beta.2", { next: "1.0.0-beta.10", latest: "0.9.0" }), "archive")
  assert.throws(() => canAdvanceChannel("1.0.0", "malformed"))
})

test("GitHub create and rerun operations apply semantic, forward-only latest policy", async () => {
  for (const [version, current, latest] of [
    ["0.4.0", "0.5.0", false], ["0.10.0", "0.9.0", true],
    ["0.5.0", "0.5.0", true], ["0.5.0", undefined, true],
    ["1.0.0-beta.10", "0.5.0", false],
  ]) {
    for (const existing of [false, true]) {
      const tag = `v${version}`, prerelease = version.includes("-")
      const calls = [], reads = []
      const result = await githubRelease("/tmp/verified.tgz", { name: "opencode-reviewer", version }, tag, {
        repository: "mightykatun/opencode-reviewer", token: "fixture-token",
        fetcher: async (url, init) => {
          assert.equal(new URL(url).origin, "https://api.github.com")
          assert.equal(init.headers.authorization, "Bearer fixture-token")
          assert.equal(init.redirect, "error")
          const endpoint = new URL(url).pathname.split("/releases/")[1]
          reads.push(endpoint)
          return endpoint === "latest" ? current === undefined ? new Response(null, { status: 404 }) : Response.json({ tag_name: `v${current}` })
            : existing ? Response.json({ tag_name: tag }) : new Response(null, { status: 404 })
        },
        run: (command, args) => { assert.equal(command, "gh"); calls.push(args) },
      })
      assert.deepEqual(result, { prerelease, latest, existing })
      assert.deepEqual(reads, [...(prerelease ? [] : ["latest"]), `tags/${encodeURIComponent(tag)}`])
      const repo = ["--repo", "mightykatun/opencode-reviewer"]
      assert.deepEqual(calls, existing ? [
        ["release", "upload", tag, "/tmp/verified.tgz", ...repo, "--clobber"],
        ["release", "edit", tag, "--draft=false", `--prerelease=${prerelease}`, `--latest=${latest}`, ...repo],
      ] : [["release", "create", tag, "/tmp/verified.tgz", "--verify-tag", "--generate-notes", "--title", `opencode-reviewer ${tag}`,
        ...(prerelease ? ["--prerelease"] : []), `--latest=${latest}`, ...repo]])
    }
  }
})

test("GitHub lookup failures and invalid latest metadata cannot mutate a release", async () => {
  for (const [response, expected] of [[new Response(null, { status: 403 }), /HTTP 403/], [new Response(null, { status: 503 }), /HTTP 503/],
    [Response.json({}), /returned no version tag/], [Response.json({ tag_name: "not-a-version" }), /must use a v<version> tag/],
    [Response.json({ tag_name: "v0.5.0-01" }), /leading zeros/], [Response.json({ tag_name: "v0.5.0-beta" }), /must be a stable version/],
    [Response.json({ tag_name: "v0.5.0+build" }), /build metadata/]]) {
    let writes = 0
    await assert.rejects(githubRelease("/tmp/verified.tgz", { name: "opencode-reviewer", version: "0.4.0" }, "v0.4.0", {
      repository: "mightykatun/opencode-reviewer", fetcher: async () => response,
      run: () => { writes++ },
    }), expected)
    assert.equal(writes, 0)
  }
  for (const [response, expected] of [[new Response(null, { status: 503 }), /HTTP 503/], [Response.json({ tag_name: "v0.5.0" }), /different release tag/]]) {
    let writes = 0
    await assert.rejects(githubRelease("/tmp/verified.tgz", { name: "opencode-reviewer", version: "0.4.0" }, "v0.4.0", {
      repository: "mightykatun/opencode-reviewer", fetcher: async (url) => url.endsWith("/latest") ? new Response(null, { status: 404 }) : response,
      run: () => { writes++ },
    }), expected)
    assert.equal(writes, 0)
  }
})

test("GitHub rejects noncanonical package versions before reads and writes", async () => {
  let reads = 0, writes = 0
  await assert.rejects(githubRelease("/tmp/verified.tgz", fixturePackage("0.5.0+build"), "v0.5.0+build", {
    repository: "mightykatun/opencode-reviewer",
    fetcher: async () => { reads++; return new Response(null, { status: 404 }) },
    run: () => { writes++ },
  }), /build metadata/)
  assert.equal(reads, 0)
  assert.equal(writes, 0)
})

test("serialized GitHub uploads and historical reruns preserve the newest stable release", async () => {
  for (const order of [["0.10.0", "0.9.1"], ["0.9.1", "0.10.0"]]) {
    let latest = "v0.9.0"
    const releases = new Set()
    for (const version of [...order, ...order, "1.0.0-beta.1"]) {
      const tag = `v${version}`
      await githubRelease("/tmp/verified.tgz", { name: "opencode-reviewer", version }, tag, {
        repository: "mightykatun/opencode-reviewer",
        fetcher: async (url) => url.endsWith("/latest") ? Response.json({ tag_name: latest })
          : releases.has(tag) ? Response.json({ tag_name: tag }) : new Response(null, { status: 404 }),
        run: (command, args) => {
          assert.equal(command, "gh")
          if (args[1] === "upload") return
          releases.add(tag)
          if (args.includes("--latest=true")) latest = tag
        },
      })
    }
    assert.equal(latest, "v0.10.0")
    assert.deepEqual([...releases].sort(), ["v0.10.0", "v0.9.1", "v1.0.0-beta.1"])
  }
})
