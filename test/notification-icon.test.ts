import { test } from "node:test"
import assert from "node:assert/strict"
import { inflateSync } from "node:zlib"
import { smallNotificationIcon } from "../src/notification-icon.js"

test("status PNGs have centered colored glyphs, smooth edges and balanced transparent padding", () => {
  const shapes = new Set<string>()
  for (const [kind, rgb] of [
    ["approved", [46, 204, 113]], ["attention", [245, 158, 11]],
    ["error", [239, 68, 68]], ["ended", [160, 160, 160]],
  ] as const) {
    const png = smallNotificationIcon(kind)
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
    assert.equal(png.readUInt32BE(16), 48); assert.equal(png.readUInt32BE(20), 48)
    const length = png.readUInt32BE(33)
    assert.equal(png.toString("ascii", 37, 41), "IDAT")
    const pixels = inflateSync(png.subarray(41, 41 + length))
    const positions: number[] = []
    const xs: number[] = [], ys: number[] = []
    let smoothEdge = false
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const offset = y * 193 + 1 + x * 4
      if (!pixels[offset + 3]) continue
      assert.ok(y >= 14 && y < 34 && x >= 14 && x < 34, "small mark must be centered in its canvas")
      assert.deepEqual([...pixels.subarray(offset, offset + 3)], [...rgb])
      if (pixels[offset + 3]! < 255) smoothEdge = true
      xs.push(x); ys.push(y)
      positions.push(y * 48 + x)
    }
    assert.ok(positions.length > 0)
    assert.ok(smoothEdge, "curves and diagonals must use antialiased coverage")
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs) + 1) / 2 - 24) <= 0.5)
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys) + 1) / 2 - 24) <= 0.5)
    shapes.add(JSON.stringify(positions))
  }
  assert.equal(shapes.size, 4)
})
