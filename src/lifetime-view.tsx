import path from "node:path"
import { createSignal } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { LifetimeUsage, lifetimeCost, lifetimeReport, type LifetimeTotals } from "./lifetime.js"
import { withDeadline } from "./reviewer.js"
import type { Usage } from "./usage.js"

/** Independent accounting UI: no session writes and no dependency on review visibility. */
export function lifetimeTracker(api: TuiPluginApi) {
  const store = new LifetimeUsage(path.join(api.state.path.state, "opencode-reviewer", "usage-v1"))
  const [totals, setTotals] = createSignal<LifetimeTotals>()
  const [unavailable, setUnavailable] = createSignal(false)
  let alive = true, revision = 0
  const refresh = async () => {
    const current = ++revision
    try {
      const value = await withDeadline(api.lifecycle.signal, 5000, (signal) => store.totals(signal))
      if (alive && revision === current) { setTotals(value); setUnavailable(false) }
    } catch {
      if (alive && revision === current) setUnavailable(true)
    }
  }
  const unregister = api.keymap.registerLayer({ commands: [{
    name: "opencode-reviewer.lifetime", namespace: "palette", title: "Reviewer: Lifetime usage", category: "Reviewer",
    run: () => {
      void refresh()
      api.ui.dialog.replace(() => <api.ui.DialogAlert title="Reviewer lifetime usage"
        message={unavailable() ? "Lifetime usage unavailable. Recorded totals have not been reset."
          : totals() ? lifetimeReport(totals()!) : "Loading recorded usage…"} />)
    },
  }] })
  api.lifecycle.onDispose(() => {
    alive = false
    unregister()
  })
  void refresh()
  return {
    flush: () => store.flush().catch(() => {}),
    text: () => unavailable() ? "lifetime: usage unavailable" : totals()?.requests ? lifetimeCost(totals()!) : undefined,
    record: (usage: Usage) => {
      void store.record(usage).then(refresh, () => {
        if (alive) { revision++; setUnavailable(true) }
      })
    },
  }
}
