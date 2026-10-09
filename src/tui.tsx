import { createEffect, createMemo, createSignal, Index, Match, onCleanup, Show, Switch } from "solid-js"
import { CliRenderEvents, CodeRenderable, RGBA, ScrollBoxRenderable, type BoxRenderable, type MarkdownRenderable, type Renderable } from "@opentui/core"
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
import { scannerFrame, SCANNER_FRAME_COUNT, SCANNER_INTERVAL_MS } from "./appearance.js"
import { modelPricing, usageText } from "./usage.js"
import { lifetimeTracker } from "./lifetime-view.js"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { SessionModes, SessionModeStore } from "./session-mode.js"
import { sessionModeCommands } from "./session-mode-commands.js"
import { DiagnosticTrace, measured, type DiagnosticObserver } from "./diagnostics.js"
import { parseNotificationConfig } from "./notification-config.js"
import { NotificationPolicy } from "./notification-policy.js"
import { NotificationHost } from "./notification-host.js"
import type { NotificationBackend, NotificationClick } from "./notification-types.js"
import { LinuxNotifications } from "./notification-linux.js"
import type { NotificationConfig } from "./notification-config.js"
import type { NotificationProcesses } from "./notification-process.js"
import { uiText } from "./ui-text.js"
import { HistoryStore } from "./history-store.js"
import { HistoryCoordinator, drainHistory } from "./history-coordinator.js"
import { HistoryMaintenance } from "./history-maintenance.js"
import { HistoryController, type HistoryViewState } from "./history-controller.js"
import { HistoryView, type HistoryInput } from "./history-view.js"
import { HistoryCover } from "./history-cover.js"
import type { HistoryTarget } from "./history-records.js"
import { historyCommands } from "./history-commands.js"
import { ReviewDescription } from "./review-description.js"
import { ReviewGeometryProof } from "./review-geometry.js"
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
      <Show when={animated()} fallback={uiText.review.staticIndicator}>
        <Index each={cells()}>{(cell) => {
          const color = createMemo(() => {
            const base = props.api.theme.current.textMuted
            const { brightness, alpha } = cell()
            return RGBA.fromValues(Math.min(1, base.r * brightness), Math.min(1, base.g * brightness), Math.min(1, base.b * brightness), alpha)
          })
          return <span style={{ fg: color() }}>{cell().character}</span>
        }}</Index>
      </Show>
      {" "}{props.retrying ? uiText.review.retrying : uiText.review.evaluating}
    </text>
  )
}

function highlightingComplete(node: Renderable): boolean {
  return !(node instanceof CodeRenderable && node.isHighlighting) && node.getChildren().every(highlightingComplete)
}

function ownsHit(node: Renderable, hit: number): boolean {
  return node.num === hit || (node instanceof ScrollBoxRenderable && ownsHit(node.wrapper, hit))
    || node.getChildren().some((child) => ownsHit(child, hit))
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

function ReviewFooter(props: { api: TuiPluginApi; view: View; controller: Controller; enabled: boolean; ref?: (value: BoxRenderable) => void }) {
  const [selected, setSelected] = createSignal<"approve" | "cancel">("approve")
  const state = () => props.view.autoApproval
  const label = () => { const current = state(); return current?.status === "countdown" ? uiText.autoApproval.countdown(current.seconds) : uiText.autoApproval.checking }
  return <Show when={props.enabled && (props.view.assessment?.safe || !!state())}>
    <box ref={props.ref} marginTop={1} paddingTop={1} minHeight={3} flexShrink={0} border={["top"]} borderColor={props.api.theme.current.borderSubtle}>
      <Switch>
        <Match when={state()?.status === "countdown" || state()?.status === "checking"}>
          <box flexDirection="row" gap={1}>
            <ReviewButton api={props.api} label={label()} disabled={state()?.status === "checking"}
              selected={selected() === "approve"} onHover={() => setSelected("approve")}
              onClick={() => { void props.controller.approveNow(props.view.request.id) }} />
            <ReviewButton api={props.api} label={uiText.autoApproval.cancel} selected={selected() === "cancel"} onHover={() => setSelected("cancel")}
              onClick={() => props.controller.cancelAutoApproval(props.view.request.id)} />
          </box>
        </Match>
        <Match when={state()?.status === "allowing"}>
          <ReviewButton api={props.api} label={uiText.autoApproval.allowing} disabled onClick={() => {}} />
        </Match>
        <Match when={state()?.status === "approved"}>
          <text fg={props.api.theme.current.textMuted}>{uiText.autoApproval.finishing}</text>
        </Match>
        <Match when={state()?.status === "cancelled"}>
          <text fg={props.api.theme.current.textMuted}>{uiText.autoApproval.cancelled}</text>
        </Match>
        <Match when={state()?.status === "failed"}>
          <text fg={props.api.theme.current.warning}>{uiText.autoApproval.unavailable}</text>
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
    skills: async signal => {
      const result = await measured(trace, "context.skills", () => api.client.app.skills(location(), { signal, throwOnError: true }))
      if (!Array.isArray(result.data) || result.data.length > 16384) throw new Error("Skill catalog unavailable or oversized")
      return result.data
    },
  }
}

export type NotificationBackendFactory = (click: NotificationClick, config: NotificationConfig) => NotificationBackend

/** Opt-in observations of real renderables, never a readiness override. */
export interface HistoryRenderProbeEvent {
  stage: "render-after" | "frame"
  at: number
  panel: number
  markdown?: number
  final: boolean
  streaming: boolean
  contentMatches: boolean
  children: number
  codeBlocks: number
  highlighting: boolean
  painted: boolean
  covered: boolean
  physical: boolean
  eligible: boolean
  auto?: string
  seconds?: number
  history?: "loading" | "ready" | "error"
}
export interface HistoryRenderProbe {
  cover?: () => Renderable | undefined
  observe: (event: Readonly<HistoryRenderProbeEvent>) => void | Promise<void>
}

async function reviewTui(api: TuiPluginApi, options: Parameters<TuiPlugin>[1], fileIO?: FileIO, observer?: DiagnosticObserver,
  notificationBackend?: NotificationBackendFactory, historyProbe?: HistoryRenderProbe) {
  let lifecycleAbortAt: number | undefined
  api.lifecycle.signal.addEventListener("abort", () => { lifecycleAbortAt = performance.now() }, { once: true })
  let config: Config | undefined
  let reviewOptions: Config | undefined
  let prompts = BUILTIN_PROMPTS
  let configError = ""
  let notificationConfig: ReturnType<typeof parseNotificationConfig> | undefined
  try { notificationConfig = parseNotificationConfig(options) } catch { /* Invalid desktop options disable only notifications. */ }
  try {
    const parsed = parseConfig(notificationConfig ? options : { ...options, notify: false, notifySound: false,
      notificationSoundDirectory: undefined, staleReminderSeconds: 0, notifications: undefined })
    reviewOptions = parsed
    prompts = await withDeadline(api.lifecycle.signal, parsed.timeoutMs, (signal) => loadPrompts(parsed.instructions, signal), "Prompt loading")
    config = parsed
  } catch (error) { configError = error instanceof Error ? error.message : uiText.review.invalidConfiguration }
  api.lifecycle.signal.throwIfAborted()
  const historyStore = new HistoryStore(api.state.path.state)
  const [views, setViews] = createSignal<View[]>([])
  const [sidebar, setSidebar] = createSignal<{ sessionID: string; token: symbol }>()
  const hostTrace = observer ? new DiagnosticTrace(observer, 0) : undefined
  const traces = observer ? new WeakMap<object, DiagnosticTrace>() : undefined
  let reviewSequence = 0
  const reader = contextReader(api, hostTrace)
  const modes = new SessionModes(new SessionModeStore(path.join(api.state.path.state, "opencode-reviewer", "session-mode-v1"),
    api.state.path.directory), async (id, signal) => api.state.session.get(id) ?? reader.session(id, signal))
  const history = new HistoryCoordinator(api.state.path.directory, historyStore, (id, signal) => modes.root(id, signal))
  const lifetime = lifetimeTracker(api, historyStore, (id, signal) => history.root(id, signal))
  const [historyState, setHistoryState] = createSignal<HistoryViewState>({ open: false, status: "loading", reset: 0 })
  const [revealHistory, setRevealHistory] = createSignal<{ session: string; live?: HistoryTarget }>()
  const browser = new HistoryController(api.state.path.directory, historyStore, (id, signal) => history.root(id, signal), setHistoryState)
  const maintenance = new HistoryMaintenance(api.state.path.directory, historyStore,
    (sessionID, signal) => api.client.session.get({ sessionID, directory: history.scope }, { signal, throwOnError: false }),
    id => { history.invalidateSession(id); browser.deleted(id) })
  maintenance.start()
  const historyInput: HistoryInput = { interactive: () => false, scroll: () => {} }
  const historyCover = new HistoryCover()
  const unregisterHistory = historyCommands(api, browser, () => historyInput.interactive(), (amount, page) => historyInput.scroll(amount, page))
  let notifications: NotificationHost | undefined
  if (notificationConfig?.notify) {
    try {
      const click: NotificationClick = (id, target) => {
        // A newer approval click supersedes an older save wait or deferred reveal,
        // even when its navigation must wait for the current native dialog.
        setRevealHistory(undefined)
        if (target) browser.close()
        else browser.cancelPendingPermission()
        notifications?.click(id, target)
      }
      const backend = notificationBackend ? notificationBackend(click, notificationConfig) : new LinuxNotifications(notificationConfig, click)
      notifications = new NotificationHost(api,
        new NotificationPolicy(notificationConfig, reviewOptions?.autoApprove === true, backend),
        (id, signal) => modes.root(id, signal), async signal => {
          const result = await api.client.question.list({ directory: api.state.path.directory }, { signal, throwOnError: true })
          if (!result.data) throw new Error("Pending questions unavailable")
          return result.data
        }, undefined, (id, target) => {
          if (controller.retained(id, target)) setRevealHistory({ session: id, live: target })
          else browser.openPermission(id, target, () => setRevealHistory({ session: id }))
        })
    } catch { /* Desktop initialization cannot change review behavior. */ }
  }
  const files = new FileAccess(fileIO)
  const approval = approvalTransport(api.client, api.state.path.directory)
  let visibleApproval: () => string | undefined = () => undefined
  const controller: Controller = new Controller(async (request, parent, onIdentified, onProgress, execution = { review: randomUUID() }) => {
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
          (model) => modelPricing(api.state.provider, config!.baseURL, model), undefined, onProgress, trace?.forward, undefined,
          history.observation(request, evidence.kind, config!, execution))
        worker = result
        return result
      })
    } finally {
      // The deadline races its callback. Drain the actual review's usage finalizer too.
      await worker?.catch(() => {})
    }
  }, (views) => {
    setViews(views)
    // Solid cleanup can synchronously cancel an older countdown during this
    // publication. Read current controller state rather than replaying its input.
    notifications?.snapshot(controller.pendingViews)
  }, reviewOptions, { ...(observer ? {
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
  } : approval), visibleID: () => visibleApproval() }, undefined, modes, fact => {
    history.approval(fact)
    notifications?.fact(fact)
  }, undefined, history.lifecycle)

  api.event.on("permission.asked", (event) => controller.asked(event.properties))
  api.event.on("permission.replied", (event) => {
    history.reply(event.properties)
    controller.replied(event.properties.requestID)
  })
  api.event.on("message.updated", (event) => history.message(event.properties.info))
  api.event.on("session.deleted", (event) => {
    const info = event.properties.info
    browser.deleted(info.id)
    // Roots are explicit in the event; unknown children use bounded stored ownership.
    const deletion = history.sessionDeleted(info)
    controller.deleted(info.id)
    void deletion.catch(() => {}).finally(() => modes.deleted(info.id))
  })

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
  let cleanup: Promise<void> | undefined
  const stop = () => cleanup ??= (async () => {
    const abortAt = lifecycleAbortAt ?? performance.now()
    maintenance.dispose()
    history.dispose()
    browser.dispose()
    unregisterHistory()
    const notificationCleanup = notifications?.dispose()
    pendingRefresh.dispose()
    clearInterval(interval)
    unregisterMode()
    const reviewCleanup = controller.dispose()
    setSidebar(undefined)
    const cleanupTasks = Promise.allSettled([notificationCleanup, modes.flush(), reviewCleanup])
    const storage = drainHistory(historyStore, reviewCleanup, abortAt)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.all([storage, Promise.race([cleanupTasks, new Promise(resolve => {
      timer = setTimeout(resolve, Math.max(0, abortAt + 3500 - performance.now()))
    })])])
    clearTimeout(timer)
  })()
  api.lifecycle.signal.addEventListener("abort", () => { void stop() }, { once: true })
  api.lifecycle.onDispose(stop)

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
        createEffect(() => {
          const route = api.route.current
          browser.route(route.name === "session" ? route.params?.sessionID as string | undefined : undefined)
        })
        createEffect(() => {
          const requested = revealHistory()
          if (!requested) return
          const route = api.route.current
          if (route.name !== "session" || route.params?.sessionID !== requested.session) {
            setRevealHistory(undefined); return
          }
          if (api.ui.dialog.open) return
          if (requested.live) {
            views()
            if (!controller.retained(requested.session, requested.live)) {
              setRevealHistory(undefined)
              browser.openPermission(requested.session, requested.live, () => setRevealHistory({ session: requested.session }))
              return
            }
          } else if (!historyState().open) { setRevealHistory(undefined); return }
          setRevealHistory(undefined)
          // The explicit approval click is the sole history path that reveals a
          // hidden sidebar, using the pinned host's public native command.
          if (sidebar()?.sessionID !== requested.session) api.keymap.dispatchCommand("session.sidebar.toggle")
        })
        if (notifications) createEffect(() => {
          const route = api.route.current
          notifications?.visit(route.name === "session" ? route.params?.sessionID as string | undefined : undefined)
        })
        const select = () => {
          const mounted = sidebar()
          const route = api.route.current
          if (!mounted || api.ui.dialog.open || route.name !== "session" || route.params?.sessionID !== mounted.sessionID) return
          return visibleReview(controller.views, mounted.sessionID, (id) => api.state.session.get(id))
        }
        const current = createMemo(() => { views(); return select() })
        // A stable slot root keeps the host's array normalization from replacing
        // the live sibling when the optional history sibling appears/disappears.
        return (<box position="absolute" top={0} right={0} bottom={0} width={42} zIndex={1}
          visible={!!sidebar() && !api.ui.dialog.open && api.route.current.name === "session"
            && api.route.current.params?.sessionID === sidebar()?.sessionID && (!!current() || historyState().open)}>
          <Show when={current()?.request.id} keyed>
            {(id) => {
              // Countdown publications must not remount Markdown/reset its scroll.
              const initial = current()!
              const view = () => views().find((item) => item.request.id === id) ?? initial
              let panel: BoxRenderable | undefined
              let heading: Renderable | undefined
              let ratingRegion: BoxRenderable | undefined
              let footer: BoxRenderable | undefined
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
              const geometry = new ReviewGeometryProof()
              const ownsPanelProbes = (owner: Renderable | undefined) => !!panel && !!owner && !owner.isDestroyed && owner.visible
                && ownsHit(owner, api.renderer.hitTest(panel.x + 2, panel.y + 1))
                && ownsHit(owner, api.renderer.hitTest(panel.x + 2, panel.y + panel.height - 3))
              const coveredByProbe = () => {
                if (!panel) return false
                const session = sidebar()?.sessionID
                if (session && historyCover.covers(session, [api.renderer.hitTest(panel.x + 2, panel.y + 1),
                  api.renderer.hitTest(panel.x + 2, panel.y + panel.height - 3)])) return true
                try { return !!historyProbe?.cover && ownsPanelProbes(historyProbe.cover()) } catch { return false }
              }
              const observeRender = (stage: HistoryRenderProbeEvent["stage"], eligible: boolean) => {
                if (!historyProbe || !panel) return
                const countCode = (node: Renderable): number => Number(node instanceof CodeRenderable)
                  + node.getChildren().reduce((total, child) => total + countCode(child), 0)
                const assessment = view().assessment
                const auto = view().autoApproval
                try {
                  const pending = historyProbe.observe(Object.freeze({ stage, at: performance.now(), panel: panel.num,
                    markdown: description?.num, final: !!assessment, streaming: description?.streaming ?? true,
                    contentMatches: !!assessment && description?.content === displayText(assessment.desc),
                    children: description?.getChildrenCount() ?? 0, codeBlocks: description ? countCode(description) : 0,
                    highlighting: !!description && !highlightingComplete(description),
                    painted: !!assessment && paintedAssessment === assessment, covered: coveredByProbe(),
                    physical: ownsPanelProbes(panel), eligible, auto: auto?.status,
                    seconds: auto?.status === "countdown" ? auto.seconds : undefined,
                    history: historyState().open ? historyState().status : undefined }))
                  if (pending) void Promise.resolve(pending).catch(() => {})
                } catch { /* Fixture observations cannot change approval behavior. */ }
              }
              const visible = (frame = false) => {
                if (!geometry.visible({ width: api.renderer.width, height: api.renderer.height, fast: config?.fastMode === true,
                  panel, heading, rating: ratingRegion, report: scroll, footer }, frame) || select()?.request.id !== id) return
                // Fast mode needs the current native blocker physically visible,
                // but never waits for final Markdown or a completed assessment.
                if (config?.fastMode) return ownsPanelProbes(panel) ? id : undefined
                if (!paintedAssessment || paintedAssessment !== view().assessment) return
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
                if (!ownsPanelProbes(panel) && !coveredByProbe()) return
                return id
              }
              if (config?.autoApprove) visibleApproval = visible
              if (config?.autoApprove || traces) {
                const frame = () => {
                  // Expire the previous hit-grid handoff before proving this
                  // frame. Keep the new proof for transitions before next paint.
                  historyCover.frame()
                  const presented = visible(true)
                  const trace = traces?.get(view().request)
                  if (trace) {
                    // Preview visibility probes the status row, not an as-yet absent
                    // approval footer. Code-only previews wait for highlighting.
                    if (select()?.request.id === id && panel
                      && ownsHit(panel, api.renderer.hitTest(panel.x + 2, panel.y + 1))
                      && ownsHit(panel, api.renderer.hitTest(panel.x + 2, panel.y + 3))
                      && (rating() !== undefined || (report() && description && !description.isDestroyed
                        && description.getChildrenCount() && highlightingComplete(description)))) trace.once("first-display")
                    // Keep this physical-display diagnostic truthful under the
                    // history-only cover exception; readiness observations are separate.
                    if (presented && paintedAssessment && paintedAssessment === view().assessment && ownsPanelProbes(panel)) trace.once("final-render")
                  }
                  if (config?.autoApprove) {
                    controller.presented(presented)
                    if (presented && view().autoApproval?.status === "countdown") trace?.once("approval-countdown")
                  }
                  observeRender("frame", !!presented)
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
                  observeRender("render-after", false)
                }}
                  position="absolute" top={0} right={0} bottom={0} width={42} zIndex={1}
                  paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
                  backgroundColor={api.theme.current.backgroundPanel}>
                  <text ref={(value: Renderable) => { heading = value }} fg={api.theme.current.text} flexShrink={0}><b>{uiText.review.heading}</b></text>
                  <box ref={(value: BoxRenderable) => { ratingRegion = value }} marginTop={1} flexShrink={0}>
                    <Show when={rating() !== undefined}>
                      <text fg={rating() ? api.theme.current.success : api.theme.current.error}>
                        <b>{rating() ? uiText.review.safe : uiText.review.unsafe}</b>
                      </text>
                    </Show>
                    <Show when={view().status === "analyzing" && rating() === undefined}>
                      <ReviewLoading api={api} retrying={view().progress?.phase === "retrying"} />
                    </Show>
                    <Show when={view().status === "unavailable"}>
                      <text fg={api.theme.current.warning}><b>{uiText.review.unavailable}</b></text>
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
                        {displayText(view().error ?? uiText.review.failed)}
                      </text>
                    </Show>
                    <Show when={view().assessment?.usage}>{(usage) => <>
                      <text marginTop={1} fg={api.theme.current.textMuted} width="100%" flexShrink={0}>{usageText(usage())}</text>
                      <Show when={lifetime.text()}>{(text) =>
                        <text fg={api.theme.current.textMuted} width="100%" flexShrink={0}>{text()}</text>
                      }</Show>
                    </>}</Show>
                  </scrollbox>
                  <ReviewFooter ref={(value) => { footer = value }} api={api} view={view()} controller={controller} enabled={config?.autoApprove === true} />
                </box>
              )
            }}
          </Show>
          <Show when={historyState().open && sidebar() && !api.ui.dialog.open && api.route.current.name === "session"
            && api.route.current.params?.sessionID === sidebar()?.sessionID}>
            <HistoryView api={api} controller={browser} state={historyState()} input={historyInput} cover={historyCover} session={sidebar()!.sessionID} />
          </Show>
        </box>)
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

/** Phase 0 fixture only. Explicit synthetic cover, never used by the normal plugin. */
export function withHistoryRenderProbe(probe: HistoryRenderProbe, observer?: DiagnosticObserver): TuiPlugin {
  return (api, options) => reviewTui(api, options, undefined, observer, undefined, probe)
}

/** Production history observations and notification I/O, without a cover override. */
export function withHistoryObservations(observe: HistoryRenderProbe["observe"], observer?: DiagnosticObserver,
  notifications?: NotificationBackendFactory): TuiPlugin {
  return (api, options) => reviewTui(api, options, undefined, observer, notifications, { observe })
}

/** Isolated notification backend for embedding and real-host fixtures. */
export function withNotifications(factory: NotificationBackendFactory): TuiPlugin {
  return (api, options) => reviewTui(api, options, undefined, undefined, factory)
}

/** Fixed-purpose process seam; exercises the bundled Linux/audio pipeline in fixtures. */
export function withNotificationProcesses(factory: () => NotificationProcesses): TuiPlugin {
  return (api, options) => reviewTui(api, options, undefined, undefined,
    (click, config) => new LinuxNotifications(config, click, factory()))
}

export default { id: "opencode-reviewer", tui: (api, options) => reviewTui(api, options) } satisfies TuiPluginModule
