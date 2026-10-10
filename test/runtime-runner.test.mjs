import { test } from "node:test"
import assert from "node:assert/strict"
import { executeFixture } from "../scripts/runtime-runner.mjs"
import { execFileSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

const alive = pid => {
  try { return !execFileSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" }).trim().startsWith("Z") }
  catch { return false }
}

test("runner records child failure and both output streams without converting it to success", async () => {
  const lines = []
  const result = await executeFixture(process.execPath, ["-e", 'console.log("out"); console.error("err"); process.exitCode=7'], {
    timeoutMs: 3000, output: (chunk, channel) => lines.push([channel, String(chunk).trim()]),
  })
  assert.equal(result.code, 7); assert.equal(result.timedOut, false)
  assert.deepEqual(lines.toSorted(), [["stderr", "err"], ["stdout", "out"]])
})

for (const mode of ["abort", "timeout"]) test(`runner ${mode} kills an owned wrapper and its uncooperative child, not another fixture`, { timeout: 10000 }, async () => {
  const abort = new AbortController(), survivorAbort = new AbortController()
  let parent, nested, survivor, output = ""
  const survivorRun = executeFixture(process.execPath, ["-e", 'console.log(process.pid); setInterval(()=>{},1000)'], {
    timeoutMs: 8000, graceMs: 50, signal: survivorAbort.signal, output: chunk => { survivor = Number(String(chunk).trim()) },
  })
  const code = `const {spawn}=require('node:child_process');
    process.on('SIGTERM',()=>{});
    const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); console.log(process.pid); setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
    child.stdout.on('data',data=>console.log(JSON.stringify({parent:process.pid,child:Number(data)})));
    setInterval(()=>{},1000);`
  const run = executeFixture(process.execPath, ["-e", code], { timeoutMs: mode === "timeout" ? 400 : 8000, graceMs: 50,
    signal: abort.signal, output: chunk => { output += chunk; try { ({ parent, child: nested } = JSON.parse(output)) } catch {} },
  })
  try {
    const end = Date.now() + 3000
    while ((!nested || !survivor) && Date.now() < end) await sleep(10)
    assert.ok(parent && nested && survivor)
    if (mode === "abort") abort.abort()
    const result = await run
    assert.equal(result.timedOut, mode === "timeout")
    assert.equal(result.interrupted, mode === "abort")
    assert.equal(alive(parent), false); assert.equal(alive(nested), false)
    assert.equal(alive(survivor), true)
  } finally { abort.abort(); survivorAbort.abort(); await Promise.all([run, survivorRun]) }
})

test("pre-aborted runs dispatch no child and spawn failures remain errors", async () => {
  await assert.rejects(executeFixture(process.execPath, ["-e", 'throw Error("must not run")'], {
    signal: AbortSignal.abort(new Error("stopped")), timeoutMs: 1000,
  }), /stopped/)
  await assert.rejects(executeFixture("/nonexistent-fixture-executable", [], { timeoutMs: 1000 }), /ENOENT/)
})
