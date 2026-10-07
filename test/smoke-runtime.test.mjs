import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { smokeEnvironment, smokeRuntime } from "../scripts/smoke-runtime.mjs"

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
  while (Date.now() < deadline) { if (await condition()) return; await sleep(20) }
  assert.fail("Fixture cleanup did not complete within five seconds")
}

async function owner(t, duringStart = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-runtime-test-"))
  const marker = path.join(directory, "pane-started.json")
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { smokeRuntime } from ${JSON.stringify(helper)};
    const runtime = await smokeRuntime(${JSON.stringify(directory)});
    let acknowledged = false;
    process.on("message", async (message) => {
      if (message === "stop") { await runtime.dispose(); process.disconnect(); }
      if (message === "status") process.send({acknowledged});
    });
    ${duringStart ? 'process.send({socket: runtime.socket, supervisor: runtime.supervisorPID});' : ''}
    await runtime.start("-d", "-s", "fixture", process.execPath, "-e", ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid: process.pid})); setInterval(() => {}, 1000)`)},
      ${duringStart ? '";", "wait-for", "startup-barrier"' : ''});
    acknowledged = true;
    ${duringStart ? '' : 'process.send({socket: runtime.socket, supervisor: runtime.supervisorPID, pane: Number(runtime.tmux("display-message", "-p", "-t", "fixture", "#{pane_pid}"))});'}
  `], { stdio: ["ignore", "ignore", "pipe", "ipc"] })
  let diagnostic = ""
  child.stderr.on("data", (chunk) => { diagnostic += chunk })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  t.after(async () => {
    child.kill("SIGKILL")
    await exited
    if (duringStart) {
      try { execFileSync("tmux", ["-S", path.join(directory, "tmux.sock"), "-f", "/dev/null", "wait-for", "-S", "startup-barrier"], { stdio: "ignore", timeout: 1000, env: smokeEnvironment(directory) }) } catch {}
    }
    await until(() => stopped(path.join(directory, "tmux.sock")))
    await rm(directory, { recursive: true, force: true })
  })
  const info = await new Promise((resolve, reject) => {
    child.once("message", resolve)
    child.once("error", reject)
    child.once("exit", () => reject(new Error(`Fixture owner exited before startup: ${diagnostic}`)))
  })
  return { child, exited, directory, marker, ...info }
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

test("parent death after real launch acceptance but before startup acknowledgement cleans only its own session", { timeout: 10000 }, async (t) => {
  const survivor = await owner(t)
  const fixture = await owner(t, true)
  let pane
  await until(async () => {
    try { pane = JSON.parse(await readFile(fixture.marker, "utf8")).pid; return alive(pane) } catch { return false }
  })
  const client = (...args) => execFileSync("tmux", ["-S", fixture.socket, "-f", "/dev/null", ...args], {
    encoding: "utf8", timeout: 1000, env: smokeEnvironment(fixture.directory),
  })
  assert.equal(Number(client("display-message", "-p", "-t", "fixture", "#{pane_pid}")), pane, "the actual tmux-launched program must have started")
  assert.equal(stopped(fixture.socket), false)
  const status = new Promise((resolve) => fixture.child.once("message", resolve))
  fixture.child.send("status")
  assert.deepEqual(await status, { acknowledged: false }, "the real launch barrier must still prevent owner acknowledgement")
  fixture.child.kill("SIGKILL")
  await fixture.exited
  assert.equal(alive(pane), true, "the supervisor must still own the launch blocked at the real tmux barrier")
  client("wait-for", "-S", "startup-barrier")
  await until(() => stopped(fixture.socket) && !alive(pane) && !alive(fixture.supervisor))
  assert.equal(stopped(survivor.socket), false, "interrupted startup must not stop the survivor server")
  assert.equal(alive(survivor.pane), true, "interrupted startup must not stop the survivor pane")
  survivor.child.send("stop")
  await survivor.exited
  await until(() => stopped(survivor.socket) && !alive(survivor.pane))
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

test("fixture tmux ignores HOME and XDG configuration and uses isolated server and pane state", { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-runtime-isolation-"))
  await mkdir(path.join(directory, "config/tmux"), { recursive: true })
  const hostile = "set-environment -g FIXTURE_CONFIG_WAS_LOADED yes\n"
  await writeFile(path.join(directory, ".tmux.conf"), hostile)
  await writeFile(path.join(directory, "config/tmux/tmux.conf"), hostile)
  const runtime = await smokeRuntime(directory)
  t.after(async () => { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) })
  const marker = path.join(directory, "environment.json")
  await runtime.start("-d", "-s", "fixture", process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.env)); setInterval(() => {}, 1000)`)
  let env
  await until(async () => { try { env = JSON.parse(await readFile(marker, "utf8")); return true } catch { return false } })
  assert.equal(env.FIXTURE_CONFIG_WAS_LOADED, undefined, "neither fixture-local tmux config may run")
  for (const [key, value] of Object.entries(smokeEnvironment(directory))) if (key !== "TERM") assert.equal(env[key], value)
  assert.equal(env.TERM, runtime.tmux("show-options", "-gv", "default-terminal").trim(), "pane TERM must be tmux's own configured terminal type")
  assert.equal(env.COLORTERM, "truecolor", "the host must receive explicit RGB capability despite isolated startup")
  assert.ok(env.TMUX.startsWith(`${runtime.socket},`), "tmux must inject its private socket, never inherit another server")
  assert.match(env.TMUX_PANE, /^%\d+$/)
  await runtime.dispose()
  assert.equal(stopped(runtime.socket), true)
})

test("startup environment excludes inherited tmux identities, shell hooks and credentials", () => {
  const env = smokeEnvironment("/tmp/fixture", { PATH: "/fixture/bin", HOME: "/user/home", SHELL: "/user/shell", COLORTERM: "unsupported-parent-mode",
    TMUX: "/shared/socket,1,0", TMUX_PANE: "%99", BASH_ENV: "/user/startup", ENV: "/user/startup",
    NODE_OPTIONS: "--require /user/startup", PRIVATE_TOKEN: "credential", OPENCODE_CONFIG: "/user/config" })
  assert.equal(env.PATH, "/fixture/bin")
  assert.equal(env.HOME, "/tmp/fixture")
  assert.equal(env.SHELL, "/bin/sh")
  assert.equal(env.COLORTERM, "truecolor", "RGB capability must be deterministic, not inherited from the parent")
  for (const key of ["TMUX", "TMUX_PANE", "BASH_ENV", "ENV", "NODE_OPTIONS", "PRIVATE_TOKEN", "OPENCODE_CONFIG"]) assert.equal(env[key], undefined)
})
