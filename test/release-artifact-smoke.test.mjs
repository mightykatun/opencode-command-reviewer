import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { packageFiles, inspectPackageArchive } from "../scripts/release-artifact.mjs"
import { archiveIntegrity } from "../scripts/npm-publication.mjs"

const outputs = (text) => Object.fromEntries(text.trim().split("\n").map((line) => {
  const split = line.indexOf("=")
  return [line.slice(0, split), line.slice(split + 1)]
}))

test("built package crosses the real version, npm pack, artifact and isolated verification CLIs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "release-artifact-smoke-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, "source"), artifact = path.join(root, "artifact"), isolated = path.join(root, "isolated")
  await mkdir(path.join(source, "dist"), { recursive: true })
  await mkdir(isolated)
  for (const file of [...packageFiles, "package-lock.json"]) await writeFile(path.join(source, file), await readFile(file))
  const pkg = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"))
  const versionOutput = path.join(root, "version-output"), artifactOutput = path.join(root, "artifact-output")
  const env = { ...process.env, RELEASE_TAG: `v${pkg.version}`, RELEASE_COMMIT: "a".repeat(40), GITHUB_RUN_ATTEMPT: "1", GITHUB_OUTPUT: versionOutput }
  execFileSync(process.execPath, [new URL("../scripts/release-version.mjs", import.meta.url).pathname], { cwd: source, env, stdio: "pipe" })
  const version = outputs(await readFile(versionOutput, "utf8"))
  assert.equal(version.tag, env.RELEASE_TAG)
  assert.equal(version.commit, env.RELEASE_COMMIT)
  const artifactEnv = { ...env, RELEASE_VERIFIED_TAG: version.tag, RELEASE_VERSION: version.version, RELEASE_COMMIT: version.commit,
    RELEASE_VALIDATION_ATTEMPT: version.validation_attempt, RELEASE_WORKFLOW_COMMIT: "b".repeat(40), RELEASE_RUN_ID: "123", GITHUB_OUTPUT: artifactOutput }
  const helper = new URL("../scripts/release-artifact.mjs", import.meta.url).pathname
  execFileSync(process.execPath, [helper, "prepare", artifact], { cwd: source, env: artifactEnv, stdio: "pipe" })
  const prepared = outputs(await readFile(artifactOutput, "utf8"))
  const bytes = await readFile(path.join(artifact, `${pkg.name}-${pkg.version}.tgz`))
  assert.equal(prepared.integrity, archiveIntegrity(bytes))
  assert.deepEqual(inspectPackageArchive(bytes).pkg, pkg)
  const verifyEnv = { ...artifactEnv, RELEASE_INTEGRITY: prepared.integrity }
  const verified = execFileSync(process.execPath, [helper, "verify", artifact], { cwd: isolated, env: verifyEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  assert.match(verified, /exactly five package files, matching digest and workflow identity/)
  assert.throws(() => execFileSync(process.execPath, [helper, "verify", artifact], { cwd: isolated,
    env: { ...verifyEnv, RELEASE_COMMIT: "c".repeat(40) }, stdio: "pipe" }), (error) => {
    assert.match(error.stderr.toString(), /commit differs from validated workflow/)
    return true
  })
})
