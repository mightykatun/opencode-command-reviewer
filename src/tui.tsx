import { createEffect, createMemo, createSignal, Index, Match, onCleanup, Show, Switch } from "solid-js"
import { CliRenderEvents, CodeRenderable, RGBA, SyntaxStyle, type BoxRenderable, type MarkdownRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { parseConfig, type Config } from "./config.js"
import { loadRootMessages, type ContextReader } from "./context.js"
import { Controller, displayText, visibleReview, type View } from "./controller.js"
import { evaluateEvidence } from "./evaluate.js"
import { FileAccess, type FileIO } from "./file-access.js"
import { review, withDeadline } from "./reviewer.js"
import { BUILTIN_PROMPTS, loadPrompts } from "./prompts.js"
import { approvalTransport } from "./approval.js"
import { PendingRefresh } from "./pending-refresh.js"
import { reviewSyntaxStyles, scannerFrame, SCANNER_FRAME_COUNT, SCANNER_INTERVAL_MS } from "./appearance.js"
import { modelPricing, usageText } from "./usage.js"
import { lifetimeTracker } from "./lifetime-view.js"
import path from "node:path"
import { SessionModes, SessionModeStore } from "./session-mode.js"
import { sessionModeCommands } from "./session-mode-commands.js"
import { DiagnosticTrace, measured, type DiagnosticObserver } from "./diagnostics.js"
export type { DiagnosticEvent, DiagnosticObserver } from "./diagnostics.js"

function ReviewLoading(props: { api: TuiPluginApi; retrying: boolean }) {
  const [frame, setFrame] = createSignal(0)
  const animated = createMemo(() => props.api.kv.get("animations_enabled", true))
  const cells = createMemo(() => scannerFrame(frame()))
  createEffect(() => {
    if (!animated()) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % SCANNER_FRAME_COUNT), SCANNER_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <text fg={props.api.theme.current.textMuted} height={1}>
      <Show when={animated()} fallback="[⋯]">
        <Index each={cells()}>{(cell) => {
          const color = createMemo(() => {
            const base = props.api.theme.current.textMuted
            const { brightness, alpha } = cell()
            return RGBA.fromValues(Math.min(1, base.r * brightness), Math.min(1, base.g * brightness), Math.min(1, base.b * brightness), alpha)
          })
          return <span style={{ fg: color() }}>{cell().character}</span>
        }}</Index>
      </Show>
      {props.retrying ? " Retrying" : " Evaluating"}
    </text>
  )
}

function ReviewDescription(props: { api: TuiPluginApi; text: string; streaming: boolean; ref?: (value: MarkdownRenderable) => void }) {
  const style = createMemo(() => {
    const syntax = SyntaxStyle.fromStyles(reviewSyntaxStyles(props.api.theme.current))
    // Let existing renderables finish using the native style before releasing it.
    onCleanup(() => { void props.api.renderer.idle().catch(() => {}).finally(() => syntax.destroy()) })
    return syntax
  })
  return <markdown ref={props.ref} content={displayText(props.text)} syntaxStyle={style()} fg={props.api.theme.current.markdownText} conceal={true} streaming={props.streaming} tableOptions={{ style: "grid" }} width="100%" flexShrink={0} />
}

function highlightingComplete(node: Renderable): boolean {
  return !(node instanceof CodeRenderable && node.isHighlighting) && node.getChildren().every(highlightingComplete)
}

function ownsHit(node: Renderable, hit: number): boolean {
  return node.num === hit || node.getChildren().some((child) => ownsHit(child, hit))
}

function ReviewButton(props: { api: TuiPluginApi; label: string; selected?: boolean; disabled?: boolean; onHover?: () => void; onClick: () => void }) {
  const selected = () => props.selected && !props.disabled
  const foreground = () => {
    const theme = props.api.theme.current
    if (!selected()) return theme.textMuted
    if (theme.selectedListItemText.a !== 0) return theme.selectedListItemText
    // Transparent themes need contrast against the permission selection color.
    const { r, g, b } = theme.warning
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }
  return <box paddingLeft={1} paddingRight={1}
    backgroundColor={selected() ? props.api.theme.current.warning : props.api.theme.current.backgroundMenu}
    onMouseOver={() => { if (!props.disabled) props.onHover?.() }}
    onMouseUp={(event) => {
      event.stopPropagation()
      if (event.button === 0 && !props.disabled) props.onClick()
    }}>
    <text fg={foreground()}>{props.label}</text>
  </box>
}

function ReviewFooter(props: { api: TuiPluginApi; view: View; controller: Controller; enabled: boolean }) {
  const [selected, setSelected] = createSignal<"approve" | "cancel">("approve")
  const state = () => props.view.autoApproval
  const label = () => { const current = state(); return current?.status === "countdown" ? `Allowed in ${current.seconds}s` : "Checking…" }
  return <Show when={props.enabled && props.view.assessment?.safe}>
    <box marginTop={1} paddingTop={1} minHeight={3} flexShrink={0} border={["top"]} borderColor={props.api.theme.current.borderSubtle}>
      <Switch>
        <Match when={state()?.status === "countdown" || state()?.status === "checking"}>
          <box flexDirection="row" gap={1}>
            <ReviewButton api={props.api} label={label()} disabled={state()?.status === "checking"}
              selected={selected() === "approve"} onHover={() => setSelected("approve")}
              onClick={() => { void props.controller.approveNow(props.view.request.id) }} />
            <ReviewButton api={props.api} label="Cancel" selected={selected() === "cancel"} onHover={() => setSelected("cancel")}
              onClick={() => props.controller.cancelAutoApproval(props.view.request.id)} />
          </box>
        </Match>
        <Match when={state()?.status === "allowing"}>
          <ReviewButton api={props.api} label="Allowing…" disabled onClick={() => {}} />
        </Match>
        <Match when={state()?.status === "cancelled"}>
          <text fg={props.api.theme.current.textMuted}>Auto-approval canceled</text>
        </Match>
        <Match when={state()?.status === "failed"}>
          <text fg={props.api.theme.current.warning}>! Auto-approval unavailable. Use native controls.</text>
        </Match>
      </Switch>
    </box>
  </Show>
}

function contextReader(api: TuiPluginApi, trace?: DiagnosticTrace): ContextReader {
  const location = () => ({ directory: api.state.path.directory })
  return {
    projects: async (signal) => {
      // Read already registered metadata, rather than initializing an OpenCode
      // instance (and its plugins) in an arbitrary command target directory.
      const result = await measured(trace, "context.projects", () => api.client.project.list(location(), { signal }))
      if (!result.data) throw new Error("Project metadata unavailable")
      return result.data
    },
    session: async (sessionID, signal) => {
      const result = await measured(trace, "context.session", () => api.client.session.get({ sessionID, ...location() }, { signal }))
      return result.data
    },
    message: async (sessionID, messageID, signal) => {
      const result = await measured(trace, "context.message", () => api.client.session.message({ sessionID, messageID, ...location() }, { signal }))
      return result.data
    },
    // History duration includes the bounded public pagination traversal.
    messages: (sessionID, signal) => measured(trace, "context.messages", () => loadRootMessages(api.client, sessionID, location().directory, signal)),
    toolIDs: async (signal) => {
      const result = await measured(trace, "context.tool-ids", () => api.client.tool.ids(location(), { signal }))
      if (!result.data) throw new Error("Tool registry unavailable")
      return result.data
    },
    definition: async (info, tool, signal) => {
      if (typeof info.providerID !== "string" || typeof info.modelID !== "string") return
      const result = await measured(trace, "context.definition", () => api.client.tool.list({ ...location(), provider: info.providerID, model: info.modelID }, { signal }))
      const matches = result.data?.filter((item) => item.id === tool)
      return matches?.length === 1 ? matches[0] : undefined
    },
    mcpServers: () => api.state.mcp(),
  }
}

async function reviewTui(api: TuiPluginApi, options: Parameters<TuiPlugin>[1], fileIO?: FileIO, observer?: DiagnosticObserver) {
  let config: Config | undefined
  let reviewOptions: Config | undefined
  let prompts = BUILTIN_PROMPTS
  let configError = ""
  try {
    const parsed = parseConfig(options)
    reviewOptions = parsed
    prompts = await withDeadline(api.lifecycle.signal, parsed.timeoutMs, (signal) => loadPrompts(parsed.instructions, signal), "Prompt loading")
    config = parsed
  } catch (error) { configError = error instanceof Error ? error.message : "Invalid configuration" }
  api.lifecycle.signal.throwIfAborted()
  const lifetime = lifetimeTracker(api)
  const [views, setViews] = createSignal<View[]>([])
  const [sidebar, setSidebar] = createSignal<{ sessionID: string; token: symbol }>()
  const hostTrace = observer ? new DiagnosticTrace(observer, 0) : undefined
  const traces = observer ? new WeakMap<object, DiagnosticTrace>() : undefined
  let reviewSequence = 0
  const reader = contextReader(api, hostTrace)
  const modes = new SessionModes(new SessionModeStore(path.join(api.state.path.state, "opencode-reviewer", "session-mode-v1"),
    api.state.path.directory), async (id, signal) => api.state.session.get(id) ?? reader.session(id, signal))
  const files = new FileAccess(fileIO)
  const approval = approvalTransport(api.client, api.state.path.directory)
  let visibleApproval: () => string | undefined = () => undefined
  const controller: Controller = new Controller(async (request, parent, onIdentified, onProgress) => {
    const trace = observer ? new DiagnosticTrace(observer, ++reviewSequence) : undefined
    if (trace) traces!.set(request, trace)
    const reviewReader = trace ? contextReader(api, trace) : reader
    let worker: Promise<unknown> | undefined
    try {
      return await withDeadline(parent, config?.timeoutMs ?? 30000, async (signal) => {
        const evidence = await evaluateEvidence(request, reviewReader, reviewOptions ?? { reviewBash: true, reviewEdits: true }, config, configError, signal, onIdentified, files)
        if (!evidence) return null
        signal.throwIfAborted()
        const result = review(evidence, config!, signal, undefined, undefined, prompts,
          (model) => modelPricing(api.state.provider, config!.baseURL, model), lifetime.record, onProgress, trace?.forward)
        worker = result
        return result
      })
    } finally {
      // The deadline races its callback. Drain the actual review's usage finalizer too.
      await worker?.catch(() => {})
    }
  }, setViews, reviewOptions, { ...(observer ? {
    list: (signal: AbortSignal) => {
      const pending = controller.views
      const view = pending.some((view) => view.autoApproval?.status === "failed") ? undefined
        : pending.find((view) => view.autoApproval?.status === "checking")
      // The public list call has no request argument. Recovery or overlapping
      // verification/recovery stays instance-wide rather than guessing ownership.
      return measured(view ? traces?.get(view.request) : hostTrace,
        view ? "approval-verification" : "approval-read", () => approval.list(signal))
    },
    once: (request, signal) => measured(traces?.get(request), "approval-reply", () => approval.once(request, signal)),
  } : approval), visibleID: () => visibleApproval() }, undefined, modes)

  api.event.on("permission.asked", (event) => controller.asked(event.properties))
  api.event.on("permission.replied", (event) => controller.replied(event.properties.requestID))
  api.event.on("session.deleted", (event) => { modes.deleted(event.properties.info.id); controller.deleted(event.properties.info.id) })

  // Startup recovery and bounded reconciliation cover attachment to an existing
  // request and cancellation paths that do not emit permission.replied.
  const pendingRefresh = new PendingRefresh(controller,
    (signal) => measured(hostTrace, "pending-refresh", () => approval.list(signal)), api.lifecycle.signal)
  const refresh = () => pendingRefresh.refresh()
  const unregisterMode = sessionModeCommands(api, modes, (root) => { controller.modeChanged(root); void refresh() })
  void refresh()
  const interval = setInterval(() => void refresh(), 2000)
  api.event.on("session.idle", () => void refresh())
  api.event.on("session.error", () => void refresh())
  api.lifecycle.onDispose(async () => {
    pendingRefresh.dispose()
    clearInterval(interval)
    setSidebar(undefined)
    unregisterMode()
    await controller.dispose()
    await modes.flush().catch(() => {})
    await lifetime.flush()
  })

  api.slots.register({
    slots: {
      sidebar_content: (_ctx, props) => {
        // Observe the native sidebar's lifetime without changing its contents or
        // visibility settings. A token protects a new mount from stale cleanup.
        const token = Symbol()
        createEffect(() => {
          setSidebar({ sessionID: props.session_id, token })
          onCleanup(() => setSidebar((current) => current?.token === token ? undefined : current))
        })
        return null
      },
      app: () => {
        const select = () => {
          const mounted = sidebar()
          const route = api.route.current
          if (!mounted || api.ui.dialog.open || route.name !== "session" || route.params?.sessionID !== mounted.sessionID) return
          return visibleReview(controller.views, mounted.sessionID, (id) => api.state.session.get(id))
        }
        const current = createMemo(() => { views(); return select() })
        return (
          <Show when={current()?.request.id} keyed>
            {(id) => {
              // Countdown publications must not remount Markdown/reset its scroll.
              const initial = current()!
              const view = () => views().find((item) => item.request.id === id) ?? initial
              let panel: BoxRenderable | undefined
              let description: MarkdownRenderable | undefined
              let scroll: ScrollBoxRenderable | undefined
              let attempt = 0
              createEffect(() => {
                const progress = view().progress
                if (progress && progress.attempt !== attempt) {
                  attempt = progress.attempt
                  scroll?.scrollTo(0)
                }
              })
              const rating = () => view().assessment?.safe ?? (view().status === "analyzing" ? view().progress?.preview?.safe : undefined)
              const report = () => view().assessment?.desc ?? (view().status === "analyzing" ? view().progress?.preview?.desc : undefined) ?? ""
              let paintedAssessment: View["assessment"]
              let readyAssessment: View["assessment"]
              const visible = () => {
                if (!panel || panel.isDestroyed || !panel.visible || panel.width < 4 || panel.height < 4
                  || select()?.request.id !== id || !paintedAssessment || paintedAssessment !== view().assessment) return
                // Final Markdown can have measured height while its text
                // is still hidden pending highlighting. Wait for it once;
                // scrolling newly exposed code must not interrupt the countdown.
                if (readyAssessment !== paintedAssessment) {
                  if (!description || description.isDestroyed || !description.getChildrenCount() || !highlightingComplete(description)) return
                  readyAssessment = paintedAssessment
                }
                // Public hit testing detects native fullscreen portals that cover
                // the panel without unmounting its sidebar or opening a dialog.
                // Probe the heading and the footer's interior padding, not the
                // outermost rows left uncovered by native fullscreen. The footer
                // padding also retains its hit target when buttons are replaced
                // by Allowing… before the next frame updates the hit grid.
                const x = panel.x + 2
                if (!ownsHit(panel, api.renderer.hitTest(x, panel.y + 1))
                  || !ownsHit(panel, api.renderer.hitTest(x, panel.y + panel.height - 3))) return
                return id
              }
              if (config?.autoApprove) visibleApproval = visible
              if (config?.autoApprove || traces) {
                const frame = () => {
                  const presented = visible()
                  const trace = traces?.get(view().request)
                  if (trace) {
                    // Preview visibility probes the status row, not an as-yet absent
                    // approval footer. Code-only previews wait for highlighting.
                    if (select()?.request.id === id && panel
                      && ownsHit(panel, api.renderer.hitTest(panel.x + 2, panel.y + 1))
                      && ownsHit(panel, api.renderer.hitTest(panel.x + 2, panel.y + 3))
                      && (rating() !== undefined || (report() && description && !description.isDestroyed
                        && description.getChildrenCount() && highlightingComplete(description)))) trace.once("first-display")
                    // The same completed frame/visibility gate used by approval.
                    if (presented) trace.once("final-render")
                  }
                  if (config?.autoApprove) {
                    controller.presented(presented)
                    if (presented && view().autoApproval?.status === "countdown") trace?.once("approval-countdown")
                  }
                }
                api.renderer.on(CliRenderEvents.FRAME, frame)
                onCleanup(() => {
                  api.renderer.off(CliRenderEvents.FRAME, frame)
                  if (config?.autoApprove) {
                    if (visibleApproval === visible) visibleApproval = () => undefined
                    controller.presented()
                  }
                })
              }
              return (
                // OpenCode 1.18.34's sidebar is 42 columns, including its padding.
                // The app slot lets this cover its title, sections, and footer while
                // the original sidebar remains mounted beneath it.
                <box ref={(value: BoxRenderable) => { panel = value }} renderAfter={() => {
                  const assessment = view().assessment
                  if (assessment && paintedAssessment !== assessment && description && !description.isDestroyed
                    && !description.streaming && description.content === displayText(assessment.desc)
                    && description.getChildrenCount() && highlightingComplete(description)) paintedAssessment = assessment
                }}
                  position="absolute" top={0} right={0} bottom={0} width={42} zIndex={1}
                  paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
                  backgroundColor={api.theme.current.backgroundPanel}>
                  <text fg={api.theme.current.text} flexShrink={0}><b>Permission analysis</b></text>
                  <box marginTop={1} flexShrink={0}>
                    <Show when={rating() !== undefined}>
                      <text fg={rating() ? api.theme.current.success : api.theme.current.error}>
                        <b>{rating() ? "✓ Safe" : "✗ Unsafe"}</b>
                      </text>
                    </Show>
                    <Show when={view().status === "analyzing" && rating() === undefined}>
                      <ReviewLoading api={api} retrying={view().progress?.phase === "retrying"} />
                    </Show>
                    <Show when={view().status === "unavailable"}>
                      <text fg={api.theme.current.warning}><b>! Analysis unavailable</b></text>
                    </Show>
                  </box>
                  <scrollbox ref={(value: ScrollBoxRenderable) => { scroll = value }} marginTop={1} flexGrow={1} minHeight={0} contentOptions={{ minHeight: 0 }}
                    scrollbarOptions={{ trackOptions: {
                      backgroundColor: api.theme.current.backgroundPanel,
                      foregroundColor: api.theme.current.textMuted,
                    } }}>
                    <ReviewDescription api={api} text={report()} streaming={view().status === "analyzing"} ref={(value) => { description = value }} />
                    <Show when={view().status === "unavailable"}>
                      <text fg={api.theme.current.text} width="100%" flexShrink={0}>
                        {displayText(view().error ?? "Review failed")}
                      </text>
                    </Show>
                    <Show when={view().assessment?.usage}>{(usage) => <>
                      <text marginTop={1} fg={api.theme.current.textMuted} width="100%" flexShrink={0}>{usageText(usage())}</text>
                      <Show when={lifetime.text()}>{(text) =>
                        <text fg={api.theme.current.textMuted} width="100%" flexShrink={0}>{text()}</text>
                      }</Show>
                    </>}</Show>
                  </scrollbox>
                  <ReviewFooter api={api} view={view()} controller={controller} enabled={config?.autoApprove === true} />
                </box>
              )
            }}
          </Show>
        )
      },
    },
  })
}

/** A read-only evidence adapter seam for isolated runtime fixtures/embedding. */
export function withFileAccess(io: FileIO): TuiPlugin {
  return (api, options) => reviewTui(api, options, io)
}

/** Opt-in embedding/fixture observations only; no configuration, storage or logging. */
export function withDiagnostics(observer: DiagnosticObserver): TuiPlugin {
  return (api, options) => reviewTui(api, options, undefined, observer)
}

export default { id: "opencode-reviewer", tui: (api, options) => reviewTui(api, options) } satisfies TuiPluginModule
