import assert from "node:assert/strict"
import { test } from "node:test"
import { HistoryCover } from "../src/history-cover.js"

test("only mounted history owns both stable probes in the current session", () => {
  const cover = new HistoryCover()
  assert.equal(cover.covers("root", [1, 2]), false)
  const unmount = cover.mount("root", hit => hit === 1 || hit === 2)
  assert.equal(cover.covers("other", [1, 2]), false)
  assert.equal(cover.covers("root", [1, 3]), false)
  assert.equal(cover.covers("root", [1, 2]), true)
  unmount()
  assert.equal(cover.covers("root", [1, 2]), true, "same painted grid survives close")
  assert.equal(cover.covers("root", [3, 4]), false, "unrelated fullscreen cannot inherit ownership")
  cover.frame()
  assert.equal(cover.covers("root", [1, 2]), false)
})

test("navigation and same-frame close/reopen retain only actual proven hit identity", () => {
  const cover = new HistoryCover()
  let hits = [1, 2]
  const old = cover.mount("root", hit => hits.includes(hit))
  assert.equal(cover.covers("root", [1, 2]), true)
  hits = [1, 3]
  assert.equal(cover.covers("root", [1, 2]), true)
  cover.mount("root", hit => hit === 4 || hit === 5)
  old()
  assert.equal(cover.covers("root", [4, 5]), true)
  cover.frame()
  assert.equal(cover.covers("root", [1, 2]), false)
  assert.equal(cover.covers("root", [4, 5]), true)
})
