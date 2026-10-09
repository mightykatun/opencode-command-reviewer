import { test } from "node:test"
import assert from "node:assert/strict"
import { notificationBlockers, type PendingInteraction } from "../src/notification-order.js"

test("native blockers prioritize permissions, code-unit session/request order, and independent roots", () => {
  const sessions = new Map<string, { id: string; parentID?: string }>([
    ["root", { id: "root" }], ["child", { id: "child", parentID: "root" }],
    ["deep", { id: "deep", parentID: "child" }], ["other", { id: "other" }],
  ])
  const pending: PendingInteraction[] = [
    { kind: "question", id: "a", sessionID: "root" },
    { kind: "permission", id: "b", sessionID: "root" },
    { kind: "permission", id: "b", sessionID: "child" },
    { kind: "permission", id: "Z", sessionID: "child" },
    { kind: "permission", id: "0", sessionID: "deep" },
    { kind: "permission", id: "0", sessionID: "unknown" },
    { kind: "question", id: "q", sessionID: "other" },
  ]
  const choose = () => notificationBlockers(new Set(["root", "other"]), pending, id => sessions.get(id))
  assert.equal(choose().get("root")?.id, "Z", "native code-unit order, not locale comparison or newest birth")
  assert.equal(choose().get("other")?.id, "q")
  pending.reverse()
  assert.equal(choose().get("root")?.id, "Z", "event arrival order does not change the blocker")
  assert.equal(choose().size, 2)
})
