import assert from "node:assert/strict"
import { test } from "node:test"
import { reviewGeometry, ReviewGeometryProof, type ReviewRegion } from "../src/review-geometry.js"

const region = (y: number, height: number, children: ReviewRegion[] = []): ReviewRegion => ({
  x: 120, y, width: 38, height, visible: true, isDestroyed: false, getChildren: () => children,
})
const layout = () => ({ width: 160, height: 40, fast: false,
  panel: { ...region(0, 40), x: 118, width: 42 }, heading: region(1, 1), rating: region(3, 1),
  report: region(5, 29), footer: region(35, 3, [region(37, 1)]),
})

test("normal presentation requires a usable report and actual on-screen footer descendants", () => {
  const input = layout()
  assert.equal(reviewGeometry(input), true)
  input.height = input.panel.height = 8
  input.report.height = 0
  input.footer = region(6, 3, [region(8, 1)])
  assert.equal(reviewGeometry(input), false, "wide but short layout cannot inherit earlier readiness")
  input.report.height = 1
  input.footer = region(6, 2, [region(8, 1)])
  assert.equal(reviewGeometry(input), false, "a fitting container cannot hide overflowing controls")
})

test("layout guards viewport edges, missing/destroyed elements, and wrapped control rows", () => {
  for (const key of ["heading", "rating", "report", "footer"] as const) {
    const input = layout()
    input[key].isDestroyed = true
    assert.equal(reviewGeometry(input), false, key)
  }
  const input = layout()
  input.footer = region(35, 4, [region(37, 1), region(38, 1)])
  assert.equal(reviewGeometry(input), true, "both wrapped rows fit")
  input.height = 38
  assert.equal(reviewGeometry(input), false)
  assert.equal(reviewGeometry({ ...layout(), report: undefined }), false)
  assert.equal(reviewGeometry({ ...layout(), width: 150 }), false)
})

test("fast presentation requires the heading and rating, without a final report or footer", () => {
  const input = { ...layout(), fast: true, report: undefined, footer: undefined }
  assert.equal(reviewGeometry(input), true)
  input.panel.height = input.height = 4
  assert.equal(reviewGeometry(input), true)
  input.rating.y = 4
  assert.equal(reviewGeometry(input), false)
})

test("same painted footer survives branch replacement only until its next layout", () => {
  const input = layout(), proof = new ReviewGeometryProof()
  assert.equal(proof.visible(input), false, "an unpainted layout cannot approve")
  assert.equal(proof.visible(input, true), true)
  input.footer.getChildren = () => [{ ...region(0, 0), width: 0 }]
  assert.equal(proof.visible(input), true, "Checking to Allowing replaces children before layout")
  assert.equal(proof.visible(input, true), false, "an actually painted invalid layout cannot retain old proof")
  input.footer.getChildren = () => [region(37, 1)]
  assert.equal(proof.visible(input, true), true)
  input.height = 39
  assert.equal(proof.visible(input), false, "viewport changes invalidate even when containers still fit")
  assert.equal(proof.visible(input, true), false)
  input.panel.height = 39
  assert.equal(proof.visible(input, true), true)
  input.footer = { ...input.footer }
  assert.equal(proof.visible(input), false, "new footer identity requires its own painted proof")
})
