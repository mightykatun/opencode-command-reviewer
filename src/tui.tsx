import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { parseConfig, type Config } from "./config.js"
import { loadContext, findUserPrompt, type ContextReader } from "./context.js"
import { Controller, displayText, visibleReview, type View } from "./controller.js"
import { collectEvidence } from "./evidence.js"
import { review, withDeadline } from "./reviewer.js"

function ReviewDescription(props: { api: TuiPluginApi; text: string }) {
  const style = createMemo(() => {
    const theme = props.api.theme.current
    const syntax = SyntaxStyle.fromStyles({
      default: { fg: theme.text },
      markup: { fg: theme.text },
      "markup.heading": { fg: theme.text, bold: true },
      "markup.strong": { fg: theme.text, bold: true },
      "markup.italic": { fg: theme.text, italic: true },
      "markup.raw": { fg: theme.text, bg: theme.backgroundElement },
      "markup.list": { fg: theme.text },
      "markup.link": { fg: theme.text, underline: true },
    })
    // Let existing renderables finish using the native style before releasing it.
    onCleanup(() => { void props.api.renderer.idle().catch(() => {}).finally(() => syntax.destroy()) })
    return syntax
  })
  return <markdown content={displayText(props.text)} syntaxStyle={style()} fg={props.api.theme.current.text} conceal={true} streaming={false} width="100%" flexShrink={0} />
}

function contextReader(api: TuiPluginApi): ContextReader {
  const location = () => ({ directory: api.state.path.directory })
  return {
    projects: async (signal) => {
      // Read already registered metadata, rather than initializing an OpenCode
      // instance (and its plugins) in an arbitrary command target directory.
      const result = await api.client.project.list(location(), { signal })
      if (!result.data) throw new Error("Project metadata unavailable")
      return result.data
    },
    session: async (sessionID, signal) => {
      const result = await api.client.session.get({ sessionID, ...location() }, { signal })
      return result.data
    },
    message: async (sessionID, messageID, signal) => {
      const result = await api.client.session.message({ sessionID, messageID, ...location() }, { signal })
      return result.data
    },
    messages: async (sessionID, signal) => {
      // Pages are newest-first at the API boundary; search by timestamp in each
      // page and continue if a page only contains synthetic/assistant messages.
      let before: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 20; page++) {
        signal.throwIfAborted()
        const result = await api.client.session.messages({ sessionID, limit: 100, before, ...location() }, { signal })
        if (!result.data) throw new Error("Root messages unavailable")
        const messages: { info: Message; parts: Part[] }[] = result.data
        if (findUserPrompt(messages) || messages.length < 100) return messages
        const oldest = messages.toSorted((a, b) => a.info.id.localeCompare(b.info.id))[0]?.info.id
        if (!oldest || seen.has(oldest)) break
        seen.add(oldest)
        before = oldest
      }
      return []
    },
  }
}

const tui: TuiPlugin = async (api, options) => {
  let config: Config | undefined
  let configError = ""
  try { config = parseConfig(options) } catch (error) { configError = error instanceof Error ? error.message : "Invalid configuration" }
  const [views, setViews] = createSignal<View[]>([])
  const reader = contextReader(api)
  const controller = new Controller(async (request, parent, setCommand) => {
    return withDeadline(parent, config?.timeoutMs ?? 30000, async (signal) => {
      const context = await loadContext(request, reader, signal)
      if (!context) return null
      setCommand(context.command)
      if (!config) throw new Error(configError)
      const evidence = await collectEvidence(context, config, signal)
      return review(evidence, config, signal)
    })
  }, setViews)

  api.event.on("permission.asked", (event) => controller.asked(event.properties))
  api.event.on("permission.replied", (event) => controller.replied(event.properties.requestID))
  api.event.on("session.deleted", (event) => controller.deleted(event.properties.info.id))

  // Startup recovery and bounded reconciliation cover attachment to an existing
  // request and cancellation paths that do not emit permission.replied.
  let syncing = false
  let stopped = false
  const refresh = async () => {
    if (syncing || stopped) return
    syncing = true
    const revision = controller.revision
    try {
      await withDeadline(api.lifecycle.signal, 5000, async (signal) => {
        const result = await api.client.permission.list({ directory: api.state.path.directory }, { signal })
        if (result.data) controller.reconcile(result.data, revision)
      })
    } catch { /* The next refresh retries the read; permission controls stay native. */ }
    finally { syncing = false }
  }
  void refresh()
  const interval = setInterval(() => void refresh(), 2000)
  api.event.on("session.idle", () => void refresh())
  api.event.on("session.error", () => void refresh())
  api.lifecycle.onDispose(() => {
    stopped = true
    clearInterval(interval)
    controller.dispose()
  })

  api.slots.register({
    slots: {
      app_bottom: () => {
        const current = createMemo(() => {
          const route = api.route.current
          const id = route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
          return visibleReview(views(), id, (id) => api.state.session.get(id))
        })
        return (
          <Show when={current()} keyed>
            {(view) => (
              <box paddingLeft={5} paddingRight={2} flexShrink={0}>
                {/* The public bottom slot sits outside the session column. Keep the
                    note transparent and compact so it stays beneath the approval. */}
                <box width="100%" maxWidth={72} flexDirection="row" gap={1} flexShrink={0}>
                  <text flexShrink={0} fg={view.status === "analyzing" ? api.theme.current.textMuted : view.assessment?.safe ? "#22c55e" : "#f97316"}>
                    {view.status === "analyzing" ? "…" : view.assessment?.safe ? "✓" : "!"}
                  </text>
                  <scrollbox maxHeight={6} flexGrow={1} flexShrink={1}>
                    <Show when={view.assessment} fallback={
                      <text fg={api.theme.current.text}>
                        {displayText(view.status === "analyzing" ? "Analyzing…" : `Analysis unavailable: ${view.error ?? "Review failed"}`)}
                      </text>
                    }>
                      {(assessment) => <ReviewDescription api={api} text={assessment().desc} />}
                    </Show>
                  </scrollbox>
                </box>
              </box>
            )}
          </Show>
        )
      },
    },
  })
}

export default { id: "opencode-command-reviewer", tui } satisfies TuiPluginModule
