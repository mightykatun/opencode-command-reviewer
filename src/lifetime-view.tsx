import path from "node:path"
import { createSignal } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { LifetimeUsage, lifetimeCost, lifetimeReport, type LifetimeTotals } from "./lifetime.js"
import { LifetimeRefresh } from "./lifetime-refresh.js"
import type { Usage } from "./usage.js"
import { uiText } from "./ui-text.js"

/** Independent accounting UI: no session writes and no dependency on review visibility. */
export function lifetimeTracker(api: TuiPluginApi) {
  const directory = path.join(api.state.path.state, "opencode-reviewer")
  const store = new LifetimeUsage(path.join(directory, "usage-v2"), path.join(directory, "usage-v1"))
  const [totals, setTotals] = createSignal<LifetimeTotals>()
  const [unavailable, setUnavailable] = createSignal(false)
  const refresh = new LifetimeRefresh((signal) => store.totals(signal), (value) => {
    if (value) { setTotals(value); setUnavailable(false) }
    else setUnavailable(true)
  }, api.lifecycle.signal)
  const unregister = api.keymap.registerLayer({ commands: [{
    name: "opencode-reviewer.lifetime", namespace: "palette", title: uiText.commands.lifetime, category: uiText.commands.category,
    run: () => {
      refresh.refresh()
      api.ui.dialog.replace(() => <api.ui.DialogAlert title={uiText.lifetime.title}
        message={unavailable() ? uiText.lifetime.unavailable
          : totals() ? lifetimeReport(totals()!) : uiText.lifetime.loading} />)
    },
  }] })
  api.lifecycle.onDispose(() => {
    refresh.dispose()
    unregister()
  })
  refresh.refresh()
  return {
    // The controller must settle aborted review workers before this final queue drain.
    flush: () => store.flush().catch(() => {}),
    text: () => unavailable() ? uiText.lifetime.inlineUnavailable : totals()?.requests ? lifetimeCost(totals()!) : undefined,
    record: (usage: Usage) => {
      // Finalizers still enqueue writes after the refresh coordinator is stopped.
      void store.record(usage).then(() => refresh.refresh(), () => refresh.failed())
    },
  }
}
