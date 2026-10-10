import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { packageFiles, inspectPackageArchive } from "../scripts/release-artifact.mjs"
import { archiveIntegrity } from "../scripts/npm-publication.mjs"
import { soundBanner, verifyBundledSounds } from "../scripts/bundled-sounds.mjs"
import { archiveFixture } from "./release-fixture.mjs"

test("the built audio constructor consumes the inspected mapping and actual bundle/archive mutations fail", async () => {
  const bundle = await readFile("dist/tui.js", "utf8")
  const assets = Object.fromEntries(await Promise.all(["attention", "unsafe", "question", "approved", "error", "ended"]
    .map(async kind => [kind, await readFile(`sounds/${kind}.mp3`)])))
  const sounds = verifyBundledSounds(bundle, assets)
  // Parse only, without evaluating any package code. Follow the emitted binding
  // to the production constructor default so a detached data banner cannot pass.
  const { parseSync } = createRequire(path.resolve("package.json"))("@babel/core")
  const ast = parseSync(bundle, { sourceType: "module", babelrc: false, configFile: false })
  const nodes = []
  const walk = node => {
    if (!node || typeof node !== "object") return
    if (node.type) nodes.push(node)
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "leadingComments", "trailingComments", "innerComments", "tokens"].includes(key)) continue
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === "object") walk(value)
    }
  }
  walk(ast.program)
  const bindings = nodes.filter(node => node.type === "VariableDeclarator" && node.init?.type === "ConditionalExpression"
    && node.init.alternate?.name === "__REVIEWER_BUNDLED_SOUNDS__")
  assert.equal(bindings.length, 1, "the inspected object must feed one audio default binding")
  const audio = nodes.find(node => node.type === "VariableDeclarator" && node.id.name === "NotificationAudio")
  assert.equal(audio?.init.type, "ClassExpression")
  const constructor = audio.init.body.body.find(node => node.kind === "constructor")
  assert.ok(constructor.params.some(node => node.type === "AssignmentPattern" && node.left.name === "sounds"
    && node.right.name === bindings[0].id.name), "audio must consume the inspected mapping by default")
  const originalFiles = new Map(await Promise.all(packageFiles.map(async file => [file, await readFile(file)])))
  for (const mutate of [s => { delete s.unsafe }, s => { delete s.question },
    s => { s.unsafe = s.approved }, s => { s.question = s.attention },
    s => { [s.unsafe, s.question] = [s.question, s.unsafe] }]) {
    const changed = structuredClone(sounds); mutate(changed)
    const invalid = soundBanner(changed) + bundle.slice(bundle.indexOf("\n"))
    assert.throws(() => verifyBundledSounds(invalid, assets))
    const files = new Map(originalFiles); files.set("dist/tui.js", Buffer.from(invalid))
    const archive = archiveFixture({ entries: [...files].map(([name, content]) => ({ name: `package/${name}`, content })) })
    assert.throws(() => verifyBundledSounds(inspectPackageArchive(archive).files.get("dist/tui.js").toString("utf8"), assets))
  }
})

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
  const sounds = Object.fromEntries(await Promise.all(["attention", "unsafe", "question", "approved", "error", "ended"]
    .map(async kind => [kind, await readFile(`sounds/${kind}.mp3`)])))
  verifyBundledSounds((await readFile(path.join(source, "dist/tui.js"))).toString("utf8"), sounds)
  verifyBundledSounds(inspectPackageArchive(bytes).files.get("dist/tui.js").toString("utf8"), sounds)
  const verifyEnv = { ...artifactEnv, RELEASE_INTEGRITY: prepared.integrity }
  const verified = execFileSync(process.execPath, [helper, "verify", artifact], { cwd: isolated, env: verifyEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  assert.match(verified, /exactly five package files, matching digest and workflow identity/)
  assert.throws(() => execFileSync(process.execPath, [helper, "verify", artifact], { cwd: isolated,
    env: { ...verifyEnv, RELEASE_COMMIT: "c".repeat(40) }, stdio: "pipe" }), (error) => {
    assert.match(error.stderr.toString(), /commit differs from validated workflow/)
    return true
  })
})
