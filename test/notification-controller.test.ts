import { test } from "node:test"
import assert from "node:assert/strict"
import { setImmediate as settle } from "node:timers/promises"
import { Controller, type ApprovalFact } from "../src/controller.js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"

const request: PermissionRequest = { id: "p", sessionID: "root", permission: "bash", patterns: [], metadata: {}, always: [] }

test("confirmation fact survives native resolution before HTTP acknowledgement and retains automatic origin", async () => {
  const facts: ApprovalFact[] = []
  let callback: (() => void) | undefined
  const controller = new Controller(async () => ({ safe: true, desc: "fixture" }), () => {},
    { reviewBash: true, reviewEdits: true, autoApprove: true, autoApproveDelaySeconds: 0 }, {
      visibleID: () => "p", list: async () => [request],
      once: async () => { controller.replied("p") },
    }, { now: () => 0, after: (_ms, cb) => { callback = cb; return () => { callback = undefined } } }, undefined,
    fact => { facts.push(fact) })
  controller.asked(request); await settle(); controller.presented("p"); callback!(); await settle()
  assert.deepEqual(facts.map(f => [f.type, f.automatic]), [["dispatched", true], ["confirmed", true], ["settled", true]])
  assert.equal(controller.views.length, 0); await controller.dispose()
})

test("failed approval confirms pending state only through successful reconciliation; observer failures are isolated", async () => {
  let reads = 0, writes = 0
  const controller = new Controller(async () => ({ safe: true, desc: "fixture" }), () => {},
    { reviewBash: true, reviewEdits: true, autoApprove: true, autoApproveDelaySeconds: 15 }, {
      visibleID: () => "p", list: async () => { reads++; return [request] },
      once: async () => { writes++; throw new Error("uncertain") },
    }, undefined, undefined, () => Promise.reject(new Error("observer")))
  controller.asked(request); await settle(); controller.presented("p"); await controller.approveNow("p")
  assert.equal(reads, 2); assert.equal(writes, 1)
  assert.equal(controller.views[0]?.autoApproval?.status, "failed")
  assert.equal(controller.views[0]?.approvalPendingConfirmed, true)
  await controller.approveNow("p"); assert.equal(writes, 1); await controller.dispose()
})

test("manual footer confirmation is tagged manual, and a rejected acknowledgement never reports success", async () => {
  for (const failure of [false, true]) {
    const facts: ApprovalFact[] = []
    const controller = new Controller(async () => ({ safe: true, desc: "fixture" }), () => {},
      { reviewBash: true, reviewEdits: true, autoApprove: true }, {
        visibleID: () => "p", list: async () => [request],
        once: async () => { if (failure) throw new Error("no acknowledgement") },
      }, undefined, undefined, fact => { facts.push(fact) })
    controller.asked(request); await settle(); controller.presented("p"); await controller.approveNow("p")
    assert.deepEqual(facts.map(f => f.type), failure ? ["dispatched", "settled"] : ["dispatched", "confirmed", "settled"])
    assert.ok(facts.every(f => f.automatic === false)); await controller.dispose()
  }
})
