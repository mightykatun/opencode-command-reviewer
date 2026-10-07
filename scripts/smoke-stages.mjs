import assert from "node:assert/strict"

const switches = { shell: "reviewBash", edit: "reviewEdits", mcp: "reviewMcp", custom: "reviewCustomTools", "external-directory": "reviewExternalDirectories" }
export const permissionScenarios = ["mcp", "mcp-resource", "custom", "custom-bash", "external-read", "external-search", "external-edit", "external-patch"]

/** Native requests exist independently of whether their review category is enabled. */
export function reviewStagePlan(nativeStages, settings, { auto = false, held = false, cancel = false, unsafe = false, error = false, correction = false, unavailable = false } = {}) {
  let reviewed = 0
  const attempts = correction && !error ? 2 : 1
  const stages = nativeStages.map(({ kind, permission }) => {
    assert.ok(Object.hasOwn(switches, kind), "Unknown fixture review kind")
    const enabled = settings[switches[kind]] === true
    const hold = enabled && !unavailable && held && reviewed === 0
    if (enabled) reviewed++
    const automatic = enabled && auto && !unsafe && !error && !unavailable
    return { kind, permission, reviewed: enabled, attempts: enabled && !unavailable ? attempts : 0, held: hold,
      action: automatic ? cancel ? "cancel-then-manual" : "countdown" : "manual" }
  })
  return { settings, stages, nativeKinds: stages.map((stage) => stage.kind),
    reviewKinds: stages.filter((stage) => stage.attempts > 0).map((stage) => stage.kind), attemptsPerReview: attempts }
}

export function permissionStagePlan(scenario, options = {}) {
  assert.ok(permissionScenarios.includes(scenario), "Unknown permission fixture scenario")
  const { disabled = false, nativeBashEnabled = false } = options
  const mcp = scenario.startsWith("mcp"), custom = scenario.startsWith("custom"), directory = scenario.startsWith("external-")
  const kind = mcp ? "mcp" : custom ? "custom" : "external-directory"
  const permission = directory ? "external_directory" : scenario === "mcp-resource" ? "read"
    : scenario === "custom-bash" ? "bash" : custom ? "fixture_allowance" : "fixture_inspect"
  return reviewStagePlan([{ kind, permission }, ...(scenario === "external-edit" ? [{ kind: "edit", permission: "edit" }] : [])], {
    reviewBash: nativeBashEnabled, reviewEdits: true, reviewMcp: mcp && !disabled,
    reviewCustomTools: custom && !disabled, reviewExternalDirectories: directory && !disabled,
  }, options)
}

/** The real fixture and pure regressions execute this same stage order and action selection. */
export async function runPermissionStages(plan, io) {
  for (const [index, stage] of plan.stages.entries()) {
    await io.pending(stage, index)
    if (stage.reviewed) {
      if (stage.held) await io.held(stage, index)
      await io.assessment(stage, index)
    } else await io.hidden(stage, index)
    await io.capture(stage, index)
    if (stage.action !== "manual") {
      await io.countdown(stage, index)
      if (stage.action === "countdown") continue
      await io.cancel(stage, index)
    }
    await io.manual(stage, index)
  }
}
