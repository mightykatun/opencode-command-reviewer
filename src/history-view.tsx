import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { CliRenderEvents, CodeRenderable, RGBA, ScrollBoxRenderable, type MarkdownRenderable, type BoxRenderable, type Renderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { HistoryController, HistoryViewState } from "./history-controller.js"
import { uiText } from "./ui-text.js"
import { historyLayout, historyMetadata } from "./history-layout.js"
import { ReviewDescription } from "./review-description.js"
import type { HistoryCover } from "./history-cover.js"

function owns(node: Renderable, hit: number): boolean {
  // ScrollBox.getChildren exposes content children, not its public viewport.
  // Empty/loading/error views still paint that viewport at the lower probe.
  return node.num === hit || (node instanceof ScrollBoxRenderable && owns(node.wrapper, hit))
    || node.getChildren().some(child => owns(child, hit))
}
function ready(node: Renderable): boolean { return !(node instanceof CodeRenderable && node.isHighlighting) && node.getChildren().every(ready) }

function Button(props: { api: TuiPluginApi; label: string; disabled?: boolean; run: () => void }) {
  const [hover, setHover] = createSignal(false)
  const foreground = () => {
    const theme = props.api.theme.current
    if (props.disabled) return theme.textMuted
    if (!hover()) return theme.text
    if (theme.selectedListItemText.a !== 0) return theme.selectedListItemText
    const { r, g, b } = theme.warning
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }
  return <box paddingLeft={1} paddingRight={1} flexShrink={0}
    backgroundColor={hover() && !props.disabled ? props.api.theme.current.warning : props.api.theme.current.backgroundMenu}
    onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)}
    onMouseUp={event => { event.stopPropagation(); if (event.button === 0 && !props.disabled) props.run() }}>
    <text fg={foreground()}>{props.label}</text>
  </box>
}

export interface HistoryInput { interactive: () => boolean; scroll: (amount: number, page: boolean) => void }
export function HistoryView(props: { api: TuiPluginApi; controller: HistoryController; state: HistoryViewState; input: HistoryInput; cover: HistoryCover; session: string }) {
  let panel: BoxRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let description: MarkdownRenderable | undefined
  let restored = false
  let measured = ""
  let reset = props.state.reset
  const unmountCover = props.cover.mount(props.session, hit => !!panel && !panel.isDestroyed && panel.visible
    && props.controller.isCurrent(props.session) && props.api.route.current.name === "session"
    && props.api.route.current.params?.sessionID === props.session
    && panel.width >= 4 && panel.height >= 4 && owns(panel, hit))
  onCleanup(unmountCover)
  const record = () => props.state.status === "ready" ? props.state.selection?.record : undefined
  const selection = () => props.state.status === "ready" ? props.state.selection : undefined
  const index = () => uiText.history.index(selection()?.rank ?? 0, selection()?.total ?? 0)
  const layout = createMemo(() => historyLayout(record() ? uiText.history.outcomes[record()!.outcome] : undefined, index()))
  const interactive = () => !!panel && !panel.isDestroyed && panel.visible && !props.api.ui.dialog.open
    && owns(panel, props.api.renderer.hitTest(panel.x + 2, panel.y + 1))
    && owns(panel, props.api.renderer.hitTest(panel.x + 2, panel.y + panel.height - 3))
  props.input.interactive = interactive
  props.input.scroll = (amount, page) => {
    if (!interactive() || !scroll) return
    scroll.scrollBy(amount * (page ? Math.max(1, scroll.height - 1) : 1))
    props.controller.scroll = scroll.scrollTop
  }
  createEffect(() => {
    if (reset === props.state.reset) return
    reset = props.state.reset; restored = false; measured = ""
    scroll?.scrollTo(props.controller.scroll)
  })
  const frame = () => {
    if (!scroll || scroll.isDestroyed) return
    if (!restored) {
      if (record() && (!description || description.isDestroyed || !description.getChildrenCount() || !ready(description))) return
      // Markdown readiness precedes Yoga/scrollbar layout. Retain the controller's
      // offset until the measured scroll extent has survived a complete frame.
      const extent = `${scroll.scrollHeight}:${scroll.viewport.height}:${description?.height ?? 0}`
      if (extent !== measured) { measured = extent; props.api.renderer.requestRender(); return }
      scroll.scrollTo(props.controller.scroll); restored = true
    }
    else props.controller.scroll = scroll.scrollTop
  }
  props.api.renderer.on(CliRenderEvents.FRAME, frame)
  onCleanup(() => {
    props.api.renderer.off(CliRenderEvents.FRAME, frame)
    if (props.input.interactive === interactive) { props.input.interactive = () => false; props.input.scroll = () => {} }
  })
  const arrows = () => <>
    <Button api={props.api} label={uiText.history.older} disabled={!selection()?.older} run={() => props.controller.navigate("older")} />
    <Show when={layout().rows !== 3}><text fg={props.api.theme.current.text}>{index()}</text></Show>
    <Button api={props.api} label={uiText.history.newer} disabled={!selection()?.newer} run={() => props.controller.navigate("newer")} />
  </>
  return <box ref={value => { panel = value }} position="absolute" top={0} right={0} bottom={0} width={42} zIndex={2}
    paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} backgroundColor={props.api.theme.current.backgroundPanel}>
    <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
      <text fg={props.api.theme.current.text}><b>{uiText.history.heading}</b></text>
      <Button api={props.api} label={uiText.history.close} run={() => props.controller.close()} />
    </box>
    <Show when={record()}>{value => <text marginTop={1} flexShrink={0} fg={value().payload.safe ? props.api.theme.current.success : props.api.theme.current.error}>
      <b>{value().payload.safe ? uiText.review.safe : uiText.review.unsafe}</b>
    </text>}</Show>
    <Show when={selection()?.unreadable}><text marginTop={1} fg={props.api.theme.current.warning}><b>{uiText.history.unreadable}</b></text></Show>
    <scrollbox ref={value => { scroll = value }} marginTop={1} flexGrow={1} minHeight={0} contentOptions={{ minHeight: 0 }}
      scrollbarOptions={{ trackOptions: { backgroundColor: props.api.theme.current.backgroundPanel, foregroundColor: props.api.theme.current.textMuted } }}>
      <Show when={record()}>{value => <>
        <ReviewDescription api={props.api} text={value().payload.desc} streaming={false} ref={value => { description = value }} />
        <box marginTop={1} flexShrink={0}>
          <text fg={props.api.theme.current.textMuted} flexShrink={0}>{historyMetadata(value())}</text>
        </box>
      </>}</Show>
      <Show when={!selection()?.entry}><text fg={props.api.theme.current.text} flexShrink={0}>{props.state.status === "loading"
        ? uiText.history.loading : props.state.status === "error" ? uiText.history.unavailable : uiText.history.empty}</text></Show>
    </scrollbox>
    <Show when={selection()?.entry}>
      <box marginTop={1} paddingTop={1} minHeight={3} flexShrink={0} border={["top"]} borderColor={props.api.theme.current.borderSubtle}>
        <box flexDirection={layout().rows === 1 ? "row" : "column"} justifyContent="space-between" gap={layout().rows === 1 ? 1 : 0}>
          <Show when={layout().label}>{label => <box flexDirection="row"><Button api={props.api} label={label()} disabled run={() => {}} /></box>}</Show>
          <box flexGrow={1} alignItems="flex-end">
            <Show when={layout().rows === 3}><text fg={props.api.theme.current.text}>{index()}</text></Show>
            <box flexDirection="row" gap={1}>{arrows()}</box>
          </box>
        </box>
      </box>
    </Show>
  </box>
}
