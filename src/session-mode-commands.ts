import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { SessionModes } from "./session-mode.js"

export function sessionModeCommands(api: TuiPluginApi, modes: SessionModes, changed: (root: string) => void) {
  let sequence = 0
  const latest = new Map<string, number>()
  const selected = () => {
    const route = api.route.current
    return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
  }
  return api.keymap.registerLayer({ commands: [true, false].map((enabled) => ({
    name: `opencode-reviewer.${enabled ? "enable" : "disable"}`,
    namespace: "palette", slashName: `reviewer-${enabled ? "enable" : "disable"}`,
    title: `Reviewer: ${enabled ? "Enable" : "Disable"} for conversation`, category: "Reviewer",
    enabled: () => selected() !== undefined,
    run: async () => {
      const sessionID = selected()
      if (!sessionID) return
      const order = ++sequence
      let applied = false
      let root: string | undefined
      try {
        root = await modes.root(sessionID, api.lifecycle.signal)
        if ((latest.get(root) ?? 0) > order) return
        latest.set(root, order)
        // Unknown/corrupt saved mode must not become enabled through a failed read.
        if (enabled) await modes.load(root, api.lifecycle.signal)
        api.lifecycle.signal.throwIfAborted()
        if (latest.get(root) !== order) return
        const persisted = modes.set(root, enabled)
        applied = true
        changed(root)
        await persisted
        if (!api.lifecycle.signal.aborted && latest.get(root) === order) api.ui.toast({ variant: "success",
          message: `Reviewer ${enabled ? "enabled" : "disabled"} for this conversation and descendants. Saved for resume.` })
      } catch {
        if (!api.lifecycle.signal.aborted && (root === undefined || latest.get(root) === order)) api.ui.toast({ variant: "error", message: applied
          ? `Reviewer ${enabled ? "enabled" : "disabled"} locally, but saving failed. Resume may use the previous setting.`
          : "Reviewer setting unavailable. Session ancestry or saved mode could not be read." })
      }
    },
  })) })
}
