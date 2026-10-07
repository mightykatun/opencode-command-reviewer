import { createEffect, createMemo, createSignal, Index, Match, onCleanup, Show, Switch } from "solid-js"
import { CliRenderEvents, CodeRenderable, RGBA, SyntaxStyle, type BoxRenderable, type MarkdownRenderable, type Renderable } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { parseConfig, type Config } from "./config.js"
import { loadContext, loadEditContext, loadRootMessages, type ContextReader } from "./context.js"
import { Controller, displayText, visibleReview, type View } from "./controller.js"
import { collectEditEvidence, collectEvidence } from "./evidence.js"
import { review, withDeadline } from "./reviewer.js"
import { BUILTIN_PROMPTS, loadPrompts } from "./prompts.js"
import { approvalTransport } from "./approval.js"
import { reviewSyntaxStyles, scannerFrame, SCANNER_FRAME_COUNT, SCANNER_INTERVAL_MS } from "./appearance.js"
import { modelPricing, usageText } from "./usage.js"

function ReviewLoading(props: { api: TuiPluginApi }) {
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
    </text>
  )
}

function ReviewDescription(props: { api: TuiPluginApi; text: string; ref?: (value: MarkdownRenderable) => void }) {
  const style = createMemo(() => {
    const syntax = SyntaxStyle.fromStyles(reviewSyntaxStyles(props.api.theme.current))
    // Let existing renderables finish using the native style before releasing it.
    onCleanup(() => { void props.api.renderer.idle().catch(() => {}).finally(() => syntax.destroy()) })
    return syntax
  })
  return <markdown ref={props.ref} content={displayText(props.text)} syntaxStyle={style()} fg={props.api.theme.current.markdownText} conceal={true} streaming={false} tableOptions={{ style: "grid" }} width="100%" flexShrink={0} />
}

function highlightingComplete(node: Renderable): boolean {
  return !(node instanceof CodeRenderable && node.isHighlighting) && node.getChildren().every(highlightingComplete)
}

function ownsHit(node: Renderable, hit: number): boolean {
  return node.num === hit || node.getChildren().some((child) => ownsHit(child, hit))
}

function ReviewButton(props: { api: TuiPluginApi; label: string; disabled?: boolean; onClick: () => void }) {
  const [hover, setHover] = createSignal(false)
  return <box paddingLeft={1} paddingRight={1}
    backgroundColor={hover() && !props.disabled ? props.api.theme.current.primary : props.api.theme.current.backgroundElement}
    onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)}
    onMouseUp={(event) => {
      event.stopPropagation()
      if (event.button === 0 && !props.disabled) props.onClick()
    }}>
    <text fg={props.disabled ? props.api.theme.current.textMuted : hover() ? props.api.theme.current.selectedListItemText : props.api.theme.current.text}>{props.label}</text>
  </box>
}

function ReviewFooter(props: { api: TuiPluginApi; view: View; controller: Controller; enabled: boolean }) {
  const state = () => props.view.autoApproval
  const label = () => { const current = state(); return current?.status === "countdown" ? `Allowed in ${current.seconds}s` : "Checking…" }
  return <Show when={props.enabled && props.view.assessment?.safe}>
    <box marginTop={1} paddingTop={1} minHeight={3} flexShrink={0} border={["top"]} borderColor={props.api.theme.current.borderSubtle}>
      <Switch>
        <Match when={state()?.status === "countdown" || state()?.status === "checking"}>
          <box flexDirection="row" gap={1}>
            <ReviewButton api={props.api} label={label()} disabled={state()?.status === "checking"}
              onClick={() => { void props.controller.approveNow(props.view.request.id) }} />
            <ReviewButton api={props.api} label="Cancel" onClick={() => props.controller.cancelAutoApproval(props.view.request.id)} />
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
    messages: (sessionID, signal) => loadRootMessages(api.client, sessionID, location().directory, signal),
  }
}

const tui: TuiPlugin = async (api, options) => {
  let config: Config | undefined
  let reviewOptions: Config | undefined
  let prompts = BUILTIN_PROMPTS
  let configError = ""
  try {
    const parsed = parseConfig(options)
    reviewOptions = parsed
    prompts = await withDeadline(api.lifecycle.signal, parsed.timeoutMs, (signal) => loadPrompts(parsed.instructions, signal))
    config = parsed
  } catch (error) { configError = error instanceof Error ? error.message : "Invalid configuration" }
  api.lifecycle.signal.throwIfAborted()
  const [views, setViews] = createSignal<View[]>([])
  const [sidebar, setSidebar] = createSignal<{ sessionID: string; token: symbol }>()
  const reader = contextReader(api)
  let visibleApproval: () => string | undefined = () => undefined
  const controller = new Controller(async (request, parent, onIdentified) => {
    return withDeadline(parent, config?.timeoutMs ?? 30000, async (signal) => {
      const context = request.permission === "edit"
        ? await loadEditContext(request, reader, signal)
        : await loadContext(request, reader, signal)
      if (!context) return null
      onIdentified()
      if (!config) throw new Error(configError)
      const evidence = context.kind === "edit" ? await collectEditEvidence(context, config, signal) : await collectEvidence(context, config, signal)
      return review(evidence, config, signal, undefined, undefined, prompts,
        (model) => modelPricing(api.state.provider, config!.baseURL, model))
    })
  }, setViews, reviewOptions, { ...approvalTransport(api.client, api.state.path.directory), visibleID: () => visibleApproval() })

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
    setSidebar(undefined)
    controller.dispose()
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
              let paintedAssessment: View["assessment"]
              let readyAssessment: View["assessment"]
              const visible = () => {
                if (!panel || panel.isDestroyed || !panel.visible || panel.width < 4 || panel.height < 4
                  || select()?.request.id !== id || !paintedAssessment || paintedAssessment !== view().assessment) return
                // Non-streaming Markdown can have measured height while its text
                // is still hidden pending initial highlighting. Wait for it once;
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
              if (config?.autoApprove) {
                visibleApproval = visible
                const frame = () => controller.presented(visible())
                api.renderer.on(CliRenderEvents.FRAME, frame)
                onCleanup(() => {
                  api.renderer.off(CliRenderEvents.FRAME, frame)
                  if (visibleApproval === visible) visibleApproval = () => undefined
                  controller.presented()
                })
              }
              return (
                // OpenCode 1.18.34's sidebar is 42 columns, including its padding.
                // The app slot lets this cover its title, sections, and footer while
                // the original sidebar remains mounted beneath it.
                <box ref={(value: BoxRenderable) => { panel = value }} renderAfter={() => { paintedAssessment = view().assessment }}
                  position="absolute" top={0} right={0} bottom={0} width={42} zIndex={1}
                  paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
                  backgroundColor={api.theme.current.backgroundPanel}>
                  <text fg={api.theme.current.text} flexShrink={0}><b>Permission analysis</b></text>
                  <box marginTop={1} flexShrink={0}>
                    <Show when={view().status === "analyzing"} fallback={
                      <text fg={view().assessment ? view().assessment!.safe ? api.theme.current.success : api.theme.current.error : api.theme.current.warning}>
                        <b>{view().assessment ? view().assessment!.safe ? "✓ Safe" : "✗ Unsafe" : "! Analysis unavailable"}</b>
                      </text>
                    }>
                      <ReviewLoading api={api} />
                    </Show>
                  </box>
                  <scrollbox marginTop={1} flexGrow={1} minHeight={0} contentOptions={{ minHeight: 0 }}
                    scrollbarOptions={{ trackOptions: {
                      backgroundColor: api.theme.current.backgroundPanel,
                      foregroundColor: api.theme.current.textMuted,
                    } }}>
                    <Show when={view().assessment} fallback={
                      <Show when={view().status === "unavailable"}>
                        <text fg={api.theme.current.text} width="100%" flexShrink={0}>
                          {displayText(view().error ?? "Review failed")}
                        </text>
                      </Show>
                    }>
                      {(assessment) => <>
                        <ReviewDescription api={api} text={assessment().desc} ref={(value) => { description = value }} />
                        <Show when={assessment().usage}>{(usage) =>
                          <text marginTop={1} fg={api.theme.current.textMuted} width="100%" flexShrink={0}>{usageText(usage())}</text>
                        }</Show>
                      </>}
                    </Show>
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

export default { id: "opencode-reviewer", tui } satisfies TuiPluginModule
