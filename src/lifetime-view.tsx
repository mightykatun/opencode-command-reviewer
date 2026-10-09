import { createSignal } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { lifetimeCost, lifetimeReport, type LifetimeTotals } from "./lifetime.js"
import { HistoryRefresh } from "./history-refresh.js"
import type { HistoryStore } from "./history-store.js"
import { uiText } from "./ui-text.js"

/** Independent accounting UI: no session writes and no dependency on review visibility. */
export function lifetimeTracker(api: TuiPluginApi, store: Pick<HistoryStore, "query" | "onCommit" | "onWriteFailure">) {
  const [totals, setTotals] = createSignal<LifetimeTotals>()
  const [unavailable, setUnavailable] = createSignal(false)
  const refresh = new HistoryRefresh(store, { type: "totals" }, (value) => {
    if (value && "totals" in value) { setTotals(value.totals); setUnavailable(false) }
    else setUnavailable(true)
  })
  const stop = () => refresh.dispose()
  api.lifecycle.signal.addEventListener("abort", stop, { once: true })
  if (api.lifecycle.signal.aborted) stop()
  const unregister = api.keymap.registerLayer({ commands: [{
    name: "opencode-reviewer.lifetime", namespace: "palette", title: uiText.commands.lifetime, category: uiText.commands.category,
    run: () => {
      if (api.lifecycle.signal.aborted) return
      refresh.refresh()
      api.ui.dialog.replace(() => <api.ui.DialogAlert title={uiText.lifetime.title}
        message={unavailable() ? uiText.lifetime.unavailable
          : totals() ? lifetimeReport(totals()!) : uiText.lifetime.loading} />)
    },
  }] })
  api.lifecycle.onDispose(() => {
    refresh.dispose()
    api.lifecycle.signal.removeEventListener("abort", stop)
    unregister()
  })
  return {
    text: () => unavailable() ? uiText.lifetime.inlineUnavailable : totals()?.requests
      ? [lifetimeCost(totals()!), uiText.lifetime.ratings(totals()!.safe, totals()!.unsafe)].join("\n") : undefined,
  }
}
