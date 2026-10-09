// Production packed storage adapter proof, isolated from live reviewer/UI integration.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { inspectPackageArchive } from "./release-artifact.mjs"
import { smokeRuntime } from "./smoke-runtime.mjs"

const root = path.resolve(import.meta.dirname, "..")
const host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8" }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-history-storage-"))
const artifacts = path.join(root, ".runtime/history-storage")
await mkdir(artifacts, { recursive: true })
const project = path.join(temp, "project")
await mkdir(project)
await mkdir(path.join(temp, "config"))
execFileSync("git", ["init", "--quiet", project])
const output = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], { cwd: root, encoding: "utf8" }))
const pack = Array.isArray(output) ? output[0] : output["opencode-reviewer"]
const { files } = inspectPackageArchive(await readFile(path.join(temp, pack.filename)))
assert.equal(files.size, 5)
const bundle = path.join(temp, "bundle.mjs"), record = path.join(temp, "proof.json"), wrapper = path.join(temp, "storage.mjs")
await writeFile(bundle, files.get("dist/tui.js"))
await writeFile(wrapper, `
import { HistoryStore, historyWorkerSource } from ${JSON.stringify(pathToFileURL(bundle).href)}
import { Worker } from 'node:worker_threads'
import { writeFile } from 'node:fs/promises'
const context = { scope: '/synthetic', root: 'root', session: 'child', permission: 'permission', review: 'early', category: 'bash', configuredModel: 'configured', provider: 'https://example.com/v1' }
export default { id: 'history-storage-proof', tui: async api => {
  const result = { packed: true, adapter: 'bun' }
  const stores = [new HistoryStore(api.state.path.state), new HistoryStore(api.state.path.state)]
  const enqueue = (store, event) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => { off(); fail(); reject(Error('commit timeout')) }, 8000)
    const off = store.onCommit(() => { clearTimeout(timer); off(); fail(); resolve() })
    const fail = store.onWriteFailure(() => { result.writeFailure = true })
    if (!store.admit(event)) { clearTimeout(timer); off(); fail(); reject(Error('admission failed')) }
  })
  api.lifecycle.onDispose(() => Promise.all(stores.map(s => s.dispose())))
  try {
    // The exact embedded production source receives no process environment.
    const worker = new Worker(historyWorkerSource, { eval:true, env:{} })
    result.environment = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(Error('worker timeout')), 3000)
      worker.once('error', reject)
      worker.once('message', m => { clearTimeout(timer); m.error ? reject(Error(m.error)) : resolve(m.value) })
      worker.postMessage({ id:1, type:'open', file:api.state.path.state+'/probe/history-v1.sqlite', adapter:'bun' })
    })
    await worker.terminate()
    await Promise.all(stores.map((s,i) => enqueue(s, { type:'attemptFinalized', context:{...context,review:'review'+i}, at:1, attempt:'1', usage:{input:2,output:1,cost:0.1} })))
    await enqueue(stores[0], { type:'reviewAccepted', context, at:2, accepted:{safe:true,completedAt:2} })
    const later = {...context,review:'later'}
    await enqueue(stores[1], { type:'reviewAccepted', context:later, at:3, accepted:{safe:false,completedAt:3} })
    await enqueue(stores[0], { type:'approvalConfirmed', context, at:4, approval:'write', automatic:true })
    await enqueue(stores[1], { type:'permissionResolved', context:later, at:5, outcome:'manual', payload:{safe:false,completedAt:3,desc:'Latest report',reportedModel:'reported'} })
    result.history = await stores[0].query({type:'history',scope:context.scope,root:context.root})
    result.totals = await stores[1].query({type:'totals'})
    await enqueue(stores[0], {type:'sessionDeleted',context:{scope:context.scope,root:context.root,session:context.root},at:6})
    await enqueue(stores[1], { type:'permissionResolved', context:later, at:7, outcome:'manual', payload:{safe:false,completedAt:3,desc:'Must not resurrect'} })
    result.deleted = await stores[1].query({type:'history',scope:context.scope,root:context.root})
    result.retainedTotals = await stores[0].query({type:'totals'})
    const start = performance.now()
    await Promise.all(stores.map(s => s.dispose(start)))
    result.disposalMs = performance.now()-start
    const reopened = new HistoryStore(api.state.path.state)
    try { result.reopened = await reopened.query({type:'totals'}) } finally { await reopened.dispose() }
  } catch(error) { result.error = String(error) }
  finally { await Promise.all(stores.map(s => s.dispose())) }
  await writeFile(${JSON.stringify(record)}, JSON.stringify(result))
} }
`)
const runtime = await smokeRuntime(temp)
try {
  const tui = path.join(temp, "tui.json")
  await writeFile(tui, JSON.stringify({ plugin: [wrapper] }))
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ autoupdate: false }), OPENCODE_CONFIG: "", OPENCODE_CONFIG_DIR: path.join(temp, "config"), OPENCODE_TUI_CONFIG: tui,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }
  await runtime.start("-d", "-s", "proof", "-x", "160", "-y", "40", "-c", project, "env", ...Object.entries(env).map(([k,v]) => k+"="+v), host, project)
  let proof
  const end = Date.now() + 60000
  while (Date.now() < end) {
    proof = await readFile(record, "utf8").then(JSON.parse).catch(() => undefined)
    if (proof) break
    await sleep(100)
  }
  await writeFile(path.join(artifacts, "capture.txt"), runtime.tmux("capture-pane", "-p", "-t", "proof"))
  await writeFile(path.join(artifacts, "results.json"), JSON.stringify({ proof, temp, packedFiles: [...files.keys()] }, null, 2))
  assert.ok(proof, "compiled host completed storage proof")
  assert.equal(proof.error, undefined)
  assert.equal(proof.environment.environmentKeys, 0)
  assert.equal(proof.history.record.payload.safe, false)
  assert.equal(proof.history.record.outcome, "auto")
  assert.equal(proof.history.record.payload.reportedModel, "reported")
  assert.equal(proof.totals.totals.requests, 2)
  assert.equal(proof.totals.totals.safe, 1)
  assert.equal(proof.totals.totals.unsafe, 1)
  assert.equal(proof.totals.totals.activity.autoApproved, 1)
  assert.equal(proof.deleted.total, 0)
  assert.deepEqual(proof.retainedTotals.totals, proof.totals.totals)
  assert.deepEqual(proof.reopened.totals, proof.totals.totals)
  assert.ok(proof.disposalMs < 4000)
  console.log("PASS packed production Bun SQLite adapter, two clients, metadata, independent outcome, tombstones, reopen and disposal: " + artifacts)
} finally { await runtime.dispose() }
