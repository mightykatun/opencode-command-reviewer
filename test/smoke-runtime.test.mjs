import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { smokeRuntime } from "../scripts/smoke-runtime.mjs"

const helper = new URL("../scripts/smoke-runtime.mjs", import.meta.url).href
const alive = (pid) => {
  try { return !execFileSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" }).trim().startsWith("Z") }
  catch { return false }
}
const stopped = (socket) => {
  try { execFileSync("tmux", ["-S", socket, "list-sessions"], { stdio: "ignore" }); return false }
  catch { return true }
}
async function until(condition) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) { if (condition()) return; await sleep(20) }
  assert.fail("Fixture cleanup did not complete within five seconds")
}

async function owner(t, duringStart = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-runtime-test-"))
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { smokeRuntime } from ${JSON.stringify(helper)};
    const runtime = await smokeRuntime(${JSON.stringify(directory)});
    process.on("message", async (message) => {
      if (message === "stop") { await runtime.dispose(); process.disconnect(); }
    });
    ${duringStart ? 'process.send({socket: runtime.socket, supervisor: runtime.supervisorPID});' : ''}
    await runtime.start("-d", "-s", "fixture", process.execPath, "-e", "setInterval(() => {}, 1000)");
    ${duringStart ? '' : 'process.send({socket: runtime.socket, supervisor: runtime.supervisorPID, pane: Number(runtime.tmux("display-message", "-p", "-t", "fixture", "#{pane_pid}"))});'}
  `], { stdio: ["ignore", "ignore", "pipe", "ipc"] })
  let diagnostic = ""
  child.stderr.on("data", (chunk) => { diagnostic += chunk })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  t.after(async () => {
    child.kill("SIGKILL")
    await exited
    await until(() => stopped(path.join(directory, "tmux.sock")))
    await rm(directory, { recursive: true, force: true })
  })
  const info = await new Promise((resolve, reject) => {
    child.once("message", resolve)
    child.once("error", reject)
    child.once("exit", () => reject(new Error(`Fixture owner exited before startup: ${diagnostic}`)))
  })
  return { child, exited, ...info }
}

test("normal cleanup and interrupted owners stop only their own server and pane", { timeout: 20000 }, async (t) => {
  const survivor = await owner(t)
  assert.equal(alive(survivor.pane), true)
  for (const signal of [null, "SIGINT", "SIGTERM", "SIGKILL"]) {
    const fixture = await owner(t)
    assert.notEqual(fixture.socket, survivor.socket)
    if (signal) fixture.child.kill(signal)
    else fixture.child.send("stop")
    await fixture.exited
    await until(() => stopped(fixture.socket) && !alive(fixture.pane) && !alive(fixture.supervisor))
    assert.equal(stopped(survivor.socket), false, "parallel fixture must remain running")
    assert.equal(alive(survivor.pane), true, "parallel pane must remain alive")
  }
  survivor.child.send("stop")
  await survivor.exited
  await until(() => stopped(survivor.socket) && !alive(survivor.pane))
})

test("abrupt parent death during startup cannot leave a late-created session", { timeout: 10000 }, async (t) => {
  const fixture = await owner(t, true)
  fixture.child.kill("SIGKILL")
  await fixture.exited
  // Let the supervisor settle any in-flight startup before checking its cleanup.
  await sleep(250)
  await until(() => stopped(fixture.socket) && !alive(fixture.supervisor))
})

test("failed startup and repeated disposal leave no server and no referenced supervisor", { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-runtime-failure-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = await smokeRuntime(directory)
  t.after(() => runtime.dispose())
  await assert.rejects(runtime.start("--invalid-fixture-option"))
  await runtime.dispose()
  await runtime.dispose()
  assert.equal(stopped(runtime.socket), true)
  await assert.rejects(runtime.start("-d", "-s", "late"), /closed/)
})

test("parallel sessions and supervised restarts remain independent until owner disposal", { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-runtime-parallel-"))
  const runtime = await smokeRuntime(directory)
  t.after(async () => { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) })
  const start = (name) => runtime.start("-d", "-s", name, process.execPath, "-e", "setInterval(() => {}, 1000)")
  await Promise.all([start("first"), start("second")])
  const second = Number(runtime.tmux("display-message", "-p", "-t", "second", "#{pane_pid}"))
  runtime.tmux("kill-session", "-t", "first")
  assert.equal(alive(second), true)
  await start("first")
  assert.equal(runtime.tmux("list-sessions", "-F", "#{session_name}").trim().split("\n").length, 2)
  await runtime.dispose()
  await until(() => stopped(runtime.socket) && !alive(second))
})
