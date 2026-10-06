import { test } from "node:test"
import assert from "node:assert/strict"
import { scannerFrame, SCANNER_FRAME_COUNT, SCANNER_INTERVAL_MS } from "../src/appearance.js"

test("block scanner sweeps in both directions with a fading trail and end pauses", () => {
  const active = (frame: number) => scannerFrame(frame).findIndex((cell) => cell.alpha === 1)
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => active(i)), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => active(i + 17)), [6, 5, 4, 3, 2, 1, 0])
  assert.equal(scannerFrame(0).map((cell) => cell.character).join(""), "■⬝⬝⬝⬝⬝⬝⬝")
  assert.equal(scannerFrame(7).map((cell) => cell.character).join(""), "⬝⬝■■■■■■")
  assert.equal(scannerFrame(53).map((cell) => cell.character).join(""), "⬝⬝⬝⬝⬝⬝⬝⬝")
  assert.ok(scannerFrame(9)[7]!.alpha < scannerFrame(8)[7]!.alpha)
  assert.deepEqual(scannerFrame(SCANNER_FRAME_COUNT), scannerFrame(0))
  assert.equal(SCANNER_INTERVAL_MS, 40)
})

test("every scanner frame keeps a fixed width and valid opacity", () => {
  for (let frame = 0; frame < SCANNER_FRAME_COUNT; frame++) {
    const cells = scannerFrame(frame)
    assert.equal(cells.length, 8)
    for (const cell of cells) {
      assert.match(cell.character, /^[■⬝]$/)
      assert.ok(cell.alpha >= 0 && cell.alpha <= 1)
      assert.ok(cell.brightness >= 1 && cell.brightness <= 1.15)
    }
  }
})
