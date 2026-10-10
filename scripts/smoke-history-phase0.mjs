// Compiled-host compatibility only. Synthetic records, isolated state, no history implementation.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "node:http"
import { setTimeout as sleep } from "node:timers/promises"
import { inspectPackageArchive } from "./release-artifact.mjs"
import { smokeRuntime } from "./smoke-runtime.mjs"
import { runtimeArguments } from "./runtime-inventory.mjs"
import { readObservation } from "./smoke-observations.mjs"
import { activatePalette } from "./smoke-ui.mjs"

runtimeArguments("smoke-history-phase0.mjs")

const root = path.resolve(import.meta.dirname, "..")
const host = process.env.OPENCODE_BIN ?? "opencode"
assert.equal(execFileSync(host, ["--version"], { encoding: "utf8" }).trim(), "1.18.35")
const temp = await mkdtemp(path.join(tmpdir(), "reviewer-history-phase0-"))
const artifacts = path.join(root, ".runtime/history-phase0")
await mkdir(artifacts, { recursive: true })
const project = path.join(temp, "project")
await mkdir(project)
await mkdir(path.join(temp, "config"))
execFileSync("git", ["init", "--quiet", project])
// Inspect the actual archive, then stage only its validated bundle away from source.
const output = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], { cwd: root, encoding: "utf8" }))
const pack = Array.isArray(output) ? output[0] : output["opencode-reviewer"]
const { files } = inspectPackageArchive(await readFile(path.join(temp, pack.filename)))
assert.equal(files.size, 5)
const bundle = path.join(temp, "bundle.mjs")
await writeFile(bundle, files.get("dist/tui.js"))
const record = path.join(temp, "proof.json")
const wrapper = path.join(temp, "probe.mjs")
await writeFile(wrapper, `
import plugin, { historyWorkerProbeSource } from ${JSON.stringify(pathToFileURL(bundle).href)}
import { Worker } from 'node:worker_threads'
import { mkdir } from 'node:fs/promises'
import { observationPublisher } from ${JSON.stringify(new URL("./smoke-observations.mjs", import.meta.url).href)}
import { BoxRenderable, TextRenderable } from '@opentui/core'
const file = ${JSON.stringify(record)}
const result = { events: [], worker: {}, keys: [], dispatches: [] }
const publisher = observationPublisher(file)
const save = () => publisher.publish(result)
export default { id: 'reviewer-history-phase0', tui: async (api, options, meta) => {
  await plugin.tui(api, options, meta)
  const offDispatch = api.keymap.on('dispatch', event => {
    if (event.phase !== 'binding-execute' || result.dispatches.length >= 128) return
    result.dispatches.push({ mode: api.mode.current(), command: typeof event.command === 'string' ? event.command : 'function' })
    void save()
  })
  api.lifecycle.onDispose(offDispatch)
  let worker, sequence = 0, panel, label, opened = false, index = 2, row = 0
  const pending = new Map()
  async function launch() {
    worker = new Worker(historyWorkerProbeSource, { eval: true, env: {} })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('worker startup timeout')), 3000)
      worker.on('error', reject)
      worker.on('message', message => {
        if (message.ready) { clearTimeout(timer); result.worker.environmentKeys = message.environmentKeys; resolve() }
        else { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter?.reject(Error(message.error)) : waiter?.resolve(message) }
      })
    })
  }
  function call(op, extra = {}) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('worker call timeout')) }, 3000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      worker.postMessage({ id, op, ...extra })
    })
  }
  async function terminate() {
    const start = performance.now()
    let timer
    try { await Promise.race([worker.terminate(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('termination timeout')), 3000) })]) }
    finally { clearTimeout(timer) }
    return performance.now() - start
  }
  let abortAt
  api.lifecycle.signal.addEventListener('abort', () => { abortAt = performance.now(); result.events.push('abort') }, { once: true })
  api.lifecycle.onDispose(async () => {
    result.events.push('cleanup')
    opened = false
    panel?.destroyRecursively()
    try { result.worker.disposeTerminationMs = await terminate(); result.worker.disposalMs = performance.now() - abortAt }
    catch (error) { result.error = String(error) }
    await save()
    await publisher.flush()
  })
  try {
    const directory = api.state.path.state + '/phase0'
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const database = directory + '/probe.sqlite'
    await launch()
    result.worker.open = await call('open', { file: database })
    result.worker.commit = await call('commit')
    result.worker.rollback = await call('rollback')
    await call('close')
    result.worker.normalTerminationMs = await terminate()
    await launch()
    await call('open', { file: database })
    result.worker.reopened = await call('read')
    result.worker.stall = await call('stall')
    result.worker.ready = true
  } catch (error) { result.error = String(error) }
  await save()
  function paint() { if (label) label.content = 'Analysis history\\n\\nSynthetic report ' + index + '\\nRow ' + row + '\\n\\n' + index + '/2' }
  function open() {
    opened = true; index = 2; row = 0
    if (!panel) {
      panel = new BoxRenderable(api.renderer, { id: 'phase0-history', position: 'absolute', top: 0, right: 0, width: 42, height: '100%', zIndex: 2, padding: 2, backgroundColor: api.theme.current.backgroundPanel })
      label = new TextRenderable(api.renderer, { content: '', fg: api.theme.current.text })
      panel.add(label); api.renderer.root.add(panel)
    }
    panel.visible = true; paint(); result.events.push('open'); void save()
  }
  const offCommand = api.keymap.registerLayer({ commands: [{ name: 'opencode-reviewer.history', namespace: 'palette', slashName: 'reviewer-history', title: 'Reviewer: Report history', category: 'Reviewer', enabled: () => api.route.current.name === 'session', run: open }] })
  const offKeys = api.keymap.registerLayer({ priority: 100, mode: 'base', enabled: () => opened && !api.ui.dialog.open && panel?.visible && api.renderer.hitTest(panel.x + 2, panel.y + 2) === label.num,
    bindings: ['left', 'right', 'up', 'down', 'pageup', 'pagedown', 'escape'].map(key => ({ key, preventDefault: true, fallthrough: false, cmd: () => {
      result.keys.push({ key, mode: api.mode.current() })
      if (key === 'left') index = Math.max(1, index - 1)
      if (key === 'right') index = Math.min(2, index + 1)
      if (key === 'down' || key === 'pagedown') row++
      if (key === 'up' || key === 'pageup') row = Math.max(0, row - 1)
      if (key === 'escape') { opened = false; panel.visible = false }
      paint(); void save()
    } })) })
  api.lifecycle.onDispose(() => { offKeys(); offCommand() })
  api.keymap.registerLayer({ commands: [{ name: 'phase0.dispose', namespace: 'palette', title: 'Phase0: Dispose probe', run: async () => {
    result.deactivated = await api.plugins.deactivate('reviewer-history-phase0')
    result.worker.totalDisposalMs = performance.now() - abortAt
    await save()
    await publisher.close()
  } }] })
} }
`)
let calls = 0
const requests = []
const server = createServer(async (req, res) => {
  let text = ''
  for await (const chunk of req) text += chunk
  requests.push(JSON.parse(text))
  calls++
  res.writeHead(200, { "Content-Type": "text/event-stream" })
  res.end('data: '+JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Phase0 ready.' }, finish_reason: null }] })+'\n\ndata: '+JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n')
})
const runtime = await smokeRuntime(temp)
const send = (...keys) => runtime.tmux('send-keys', '-t', 'proof', ...keys)
const capture = () => runtime.tmux('capture-pane', '-p', '-t', 'proof')
const data = () => readObservation(record)
const until = async (check, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await check(capture())) return; await sleep(100) }
  throw Error('Phase0 wait timed out')
}
const save = async name => { await writeFile(path.join(artifacts, name+'.txt'), capture()); await writeFile(path.join(artifacts, name+'.ansi'), runtime.tmux('capture-pane', '-p', '-e', '-t', 'proof')) }
const palette = title => activatePalette({ send, capture: () => runtime.tmux('capture-pane', '-p', '-e', '-t', 'proof') }, title,
  title === 'Reviewer: Report history' ? s => s.includes('Analysis history') : async () => (await data()).deactivated === true)
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const config = { model: 'fixture/fixture', small_model: 'fixture/fixture', autoupdate: false, provider: { fixture: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:'+server.address().port, apiKey: 'synthetic-only' }, models: { fixture: { name: 'Fixture', limit: { context: 32000, output: 1000 } } } } } }
  const tui = path.join(temp, 'tui.json')
  await writeFile(tui, JSON.stringify({ plugin: [[wrapper, { notify: false, baseURL: 'http://127.0.0.1:'+server.address().port, model: 'fixture' }]] }))
  const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_CONFIG: '', OPENCODE_CONFIG_DIR: path.join(temp, 'config'), OPENCODE_TUI_CONFIG: tui, OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1' }
  await runtime.start('-d', '-s', 'proof', '-x', '160', '-y', '40', '-c', project, 'env', ...Object.entries(env).map(([k,v]) => k+'='+v), host, project, '--prompt', 'Say ready.')
  await until(s => s.includes('Phase0 ready.') && s.includes('tab agents'), 90000)
  const initial = await data()
  assert.equal(initial.error, undefined)
  assert.equal(initial.worker.environmentKeys, 0, 'worker receives no inherited environment credentials')
  assert.equal(initial.worker.open.value.journal_mode, 'wal')
  assert.equal(initial.worker.commit.value, 'committed', 'commit acknowledgement received')
  assert.equal(initial.worker.reopened.value.value, 'committed')
  assert.equal(initial.worker.rollback.value.value, 'committed')
  assert.equal(initial.worker.stall.entered, true)
  await until(() => calls >= 2, 15000) // Main reply plus the host's independent title request.
  await sleep(300)
  const before = calls
  await palette('Reviewer: Report history')
  await until(s => s.includes('Analysis history'))
  send('-l', 'ABC')
  send('Left', 'Left')
  await until(s => s.includes('1/2'))
  await save('older-boundary')
  send('Right', 'Right', 'Down', 'PageDown')
  await until(s => s.includes('2/2') && s.includes('Row 2'))
  await save('newer-and-scroll')
  send('Up', 'PageUp')
  await until(async () => (await data()).keys.length === 8)
  send('-l', 'Z')
  await until(s => s.includes('ABCZ') && s.includes('2/2'))
  await save('arrows-consumed')
  send('C-u')
  send('-l', '/reviewer-')
  await until(s => s.includes('/reviewer-history'))
  await save('autocomplete-open')
  const autocompleteStart = (await data()).dispatches.length
  const keys = (await data()).keys.length
  send('Down', 'Up', 'Escape')
  await sleep(400)
  assert.equal((await data()).keys.length, keys, 'autocomplete owns arrows and Escape')
  assert.deepEqual((await data()).dispatches.slice(autocompleteStart).map(event => event.command),
    ['prompt.autocomplete.next', 'prompt.autocomplete.prev', 'prompt.autocomplete.hide'])
  assert.match(capture(), /Analysis history/)
  await save('autocomplete-yield')
  send('C-u')
  send('C-p')
  await until(s => s.includes('Commands'))
  await save('dialog-open')
  const dialogStart = (await data()).dispatches.length
  send('Down', 'Up', 'Escape')
  await until(s => !s.includes('Commands'))
  assert.equal((await data()).keys.length, keys, 'dialog owns arrows and Escape')
  assert.deepEqual((await data()).dispatches.slice(dialogStart).map(event => event.command),
    ['dialog.select.next', 'dialog.select.prev', 'function'])
  await save('dialog-yield')
  send('Escape')
  await until(s => !s.includes('Analysis history'))
  send('-l', '/reviewer-history')
  await until(s => s.includes('Reviewer: Report history'))
  send('Enter')
  await until(s => s.includes('Analysis history'))
  await save('slash-open')
  assert.equal(calls, before, 'history controls never call the model')
  await palette('Phase0: Dispose probe')
  await until(async () => (await data()).deactivated === true)
  const final = await data()
  assert.equal(final.error, undefined)
  assert.ok(final.worker.disposalMs < 4000)
  assert.ok(final.worker.totalDisposalMs < 4000, 'all plugin callbacks settle within the shared budget')
  assert.ok(final.events.indexOf('abort') < final.events.indexOf('cleanup'))
  await save('disposed')
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ ...final, calls, packedFiles: [...files.keys()], temp, host: '1.18.35' }, null, 2))
  console.log('PASS Phase0 packed worker commit/rollback/reopen/stalled termination and native keymap priority: '+artifacts)
} catch (error) {
  await save('failed').catch(() => {})
  await writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ error: String(error), temp, requests, proof: await data().catch(() => null) }, null, 2))
  throw error
} finally {
  await runtime.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
