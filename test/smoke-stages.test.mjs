import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { permissionScenarios, permissionStagePlan, runPermissionStages } from "../scripts/smoke-stages.mjs"

test("external-edit keeps both native requests while disabled directory review leaves the edit review enabled", () => {
  const plan = permissionStagePlan("external-edit", { disabled: true, auto: true, held: true, correction: true })
  assert.deepEqual(plan.nativeKinds, ["external-directory", "edit"])
  assert.deepEqual(plan.reviewKinds, ["edit"])
  assert.deepEqual(plan.stages, [
    { kind: "external-directory", permission: "external_directory", reviewed: false, attempts: 0, held: false, action: "manual" },
    { kind: "edit", permission: "edit", reviewed: true, attempts: 2, held: true, action: "countdown" },
  ])
  assert.equal(plan.settings.reviewExternalDirectories, false)
  assert.equal(plan.settings.reviewEdits, true)
})

test("all permission scenarios retain native ordering and hold only their first enabled review", () => {
  for (const scenario of permissionScenarios) {
    for (const disabled of [false, true]) {
      const plan = permissionStagePlan(scenario, { disabled, auto: true, held: true })
      assert.equal(plan.stages.length, scenario === "external-edit" ? 2 : 1)
      assert.equal(plan.stages.filter((stage) => stage.held).length, plan.reviewKinds.length > 0 ? 1 : 0)
      if (disabled && scenario !== "external-edit") {
        assert.deepEqual(plan.reviewKinds, [])
        assert.ok(plan.stages.every((stage) => stage.action === "manual" && !stage.held && stage.attempts === 0))
      }
    }
  }
  const custom = permissionStagePlan("custom-bash", { disabled: true, nativeBashEnabled: true, auto: true, held: true })
  assert.equal(custom.stages[0].permission, "bash")
  assert.equal(custom.stages[0].kind, "custom")
  assert.deepEqual(custom.reviewKinds, [], "a native-looking permission must not enable a disabled custom review")
  assert.deepEqual(permissionStagePlan("external-patch").nativeKinds, ["external-directory"], "native patch permission is already allowed in this fixture")
})

async function drive(plan) {
  const events = [], reviewed = [], released = new Set()
  let current = 0
  const record = (phase, stage) => events.push(`${phase}:${stage.kind}`)
  await runPermissionStages(plan, {
    pending: async (stage, index) => { assert.equal(current, index, "earlier native permission must resolve first"); record("pending", stage) },
    held: async (stage, index) => { assert.equal(current, index); assert.equal(stage.reviewed, true); released.add(index); record("held", stage) },
    assessment: async (stage, index) => {
      if (stage.held) assert.ok(released.has(index), "held response must be released before assessment")
      reviewed.push(stage.kind)
      record("assessment", stage)
    },
    hidden: async (stage) => { assert.equal(stage.reviewed, false); record("hidden", stage) },
    capture: async (stage) => record("capture", stage),
    countdown: async (stage) => {
      assert.equal(reviewed.at(-1), stage.kind, "countdown must follow this stage's assessment")
      record("countdown", stage)
      if (stage.action === "countdown") current++
    },
    cancel: async (stage) => record("cancel", stage),
    manual: async (stage) => { record("manual", stage); current++ },
  })
  assert.equal(current, plan.stages.length)
  assert.deepEqual(reviewed, plan.reviewKinds)
  return events
}

test("the real stage driver manually resolves a disabled directory before awaiting a held auto edit", { timeout: 1000 }, async () => {
  const events = await drive(permissionStagePlan("external-edit", { disabled: true, auto: true, held: true }))
  assert.deepEqual(events, ["pending:external-directory", "hidden:external-directory", "capture:external-directory", "manual:external-directory",
    "pending:edit", "held:edit", "assessment:edit", "capture:edit", "countdown:edit"])
})

test("stage driver covers disabled/auto/held/cancel/error/unsafe combinations without waiting on disabled work", { timeout: 2000 }, async () => {
  for (const disabled of [false, true]) for (const auto of [false, true]) for (const held of [false, true]) {
    for (const outcome of [{}, { cancel: true }, { error: true, correction: true }, { unsafe: true }]) {
      const plan = permissionStagePlan("external-edit", { disabled, auto, held, ...outcome })
      const events = await drive(plan)
      if (outcome.error || outcome.unsafe) assert.ok(!events.some((event) => event.startsWith("countdown:")))
      if (outcome.error) assert.equal(plan.attemptsPerReview, 1)
      if (auto && outcome.cancel && !outcome.error && !outcome.unsafe) {
        assert.equal(events.filter((event) => event.startsWith("cancel:")).length, plan.reviewKinds.length)
      }
    }
  }
  await drive(permissionStagePlan("mcp", { disabled: true, auto: true, held: true }))
})

test("planning CLIs need no host binary, bundle, tmux server or filesystem fixture", () => {
  const env = { PATH: "", OPENCODE_BIN: "/missing-host-fixture", HOME: "/missing-home-fixture" }
  const permission = JSON.parse(execFileSync(process.execPath, [new URL("../scripts/smoke-permissions.mjs", import.meta.url).pathname,
    "external-edit", "--disabled", "--auto", "--held", "--plan"], { env, encoding: "utf8" }))
  assert.deepEqual(permission.reviewKinds, ["edit"])
  assert.equal(permission.stages[1].held, true)
  for (const [scenario, nativeKinds] of [["external-disabled", ["external-directory", "shell"]], ["edit-disabled", ["edit"]], ["bash-disabled", ["shell"]]]) {
    const main = JSON.parse(execFileSync(process.execPath, [new URL("../scripts/smoke.mjs", import.meta.url).pathname, scenario, "--plan"], { env, encoding: "utf8" }))
    assert.deepEqual(main.nativeKinds, nativeKinds)
    assert.deepEqual(main.reviewKinds, [])
  }
})
