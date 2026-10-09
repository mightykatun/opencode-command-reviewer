import { createMemo, onCleanup } from "solid-js"
import { SyntaxStyle, type MarkdownRenderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { displayText } from "./controller.js"
import { reviewSyntaxStyles } from "./appearance.js"

export function ReviewDescription(props: { api: TuiPluginApi; text: string; streaming: boolean; ref?: (value: MarkdownRenderable) => void }) {
  const style = createMemo(() => {
    const syntax = SyntaxStyle.fromStyles(reviewSyntaxStyles(props.api.theme.current))
    onCleanup(() => { void props.api.renderer.idle().catch(() => {}).finally(() => syntax.destroy()) })
    return syntax
  })
  return <markdown ref={props.ref} content={displayText(props.text)} syntaxStyle={style()} fg={props.api.theme.current.markdownText} conceal={true} streaming={props.streaming} tableOptions={{ style: "grid" }} width="100%" flexShrink={0} />
}
