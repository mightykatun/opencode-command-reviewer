import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { HistoryController } from "./history-controller.js"
import { uiText } from "./ui-text.js"

export function historyCommands(api: TuiPluginApi, controller: HistoryController,
  interactive: () => boolean, scroll: (amount: number, page: boolean) => void) {
  const selected = () => {
    const route = api.route.current
    return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
  }
  const command = api.keymap.registerLayer({ commands: [{ name: "opencode-reviewer.history", namespace: "palette",
    slashName: "reviewer-history", title: uiText.commands.history, category: uiText.commands.category,
    enabled: () => !!selected(), run: () => { const session = selected(); if (session) controller.open(session) } }] })
  const keys = api.keymap.registerLayer({ priority: 100, mode: "base",
    enabled: () => controller.state.open && !api.ui.dialog.open && interactive(),
    bindings: [
      { key: "left", cmd: () => controller.navigate("older") },
      { key: "right", cmd: () => controller.navigate("newer") },
      { key: "escape", cmd: () => controller.close() },
      { key: "up", cmd: () => scroll(-1, false) },
      { key: "down", cmd: () => scroll(1, false) },
      { key: "pageup", cmd: () => scroll(-1, true) },
      { key: "pagedown", cmd: () => scroll(1, true) },
    ] })
  return () => { command(); keys() }
}
