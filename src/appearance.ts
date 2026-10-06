import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { StyleDefinitionInput } from "@opentui/core"

/** Conversation highlight scopes in OpenCode 1.18.34, using its public theme colors. */
export function reviewSyntaxStyles(theme: TuiThemeCurrent): Record<string, StyleDefinitionInput> {
  const styles: Record<string, StyleDefinitionInput> = { default: { fg: theme.text } }
  const add = (scopes: string[], style: StyleDefinitionInput) => {
    for (const scope of scopes) styles[scope] = style
  }
  add(["markup.heading", ...Array.from({ length: 6 }, (_, i) => `markup.heading.${i + 1}`)], { fg: theme.markdownHeading, bold: true })
  styles["markup.heading.1"] = { fg: theme.markdownHeading, bold: true, underline: true }
  add(["markup.bold", "markup.strong"], { fg: theme.markdownStrong, bold: true })
  add(["markup.italic"], { fg: theme.markdownEmph, italic: true })
  add(["markup.list"], { fg: theme.markdownListItem })
  add(["markup.quote"], { fg: theme.markdownBlockQuote, italic: true })
  add(["markup.raw", "markup.raw.block"], { fg: theme.markdownCode })
  add(["markup.raw.inline"], { fg: theme.markdownCode, bg: theme.background })
  add(["markup.link", "markup.link.url", "string.special", "string.special.url"], { fg: theme.markdownLink, underline: true })
  add(["markup.link.label"], { fg: theme.markdownLinkText, underline: true })
  add(["label"], { fg: theme.markdownLinkText })
  add(["spell", "nospell"], { fg: theme.text })
  add(["conceal", "markup.strikethrough", "markup.list.unchecked", "debug"], { fg: theme.textMuted })
  add(["markup.underline"], { fg: theme.text, underline: true })
  add(["markup.list.checked"], { fg: theme.success })

  // Fenced code uses the same syntax palette as code in the conversation.
  add(["comment", "comment.documentation"], { fg: theme.syntaxComment, italic: true })
  add(["string", "symbol", "character", "character.special"], { fg: theme.syntaxString })
  add(["number", "boolean", "float", "constant"], { fg: theme.syntaxNumber })
  add(["keyword", "keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine", "keyword.directive", "keyword.modifier", "keyword.exception"], { fg: theme.syntaxKeyword, italic: true })
  add(["keyword.import", "keyword.export", "string.escape", "string.regexp", "tag.attribute"], { fg: theme.syntaxKeyword })
  add(["keyword.type"], { fg: theme.syntaxType, bold: true, italic: true })
  add(["keyword.function", "function.method", "variable.member", "function", "constructor"], { fg: theme.syntaxFunction })
  add(["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary", "punctuation.special", "tag.delimiter"], { fg: theme.syntaxOperator })
  add(["variable", "variable.parameter", "function.method.call", "function.call", "property", "parameter", "field"], { fg: theme.syntaxVariable })
  add(["type", "module", "class", "namespace"], { fg: theme.syntaxType })
  add(["type.definition"], { fg: theme.syntaxType, bold: true })
  add(["punctuation", "punctuation.bracket"], { fg: theme.syntaxPunctuation })
  add(["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin", "variable.super"], { fg: theme.error })
  add(["attribute", "annotation"], { fg: theme.warning })
  add(["tag"], { fg: theme.error })
  add(["comment.error"], { fg: theme.error, italic: true, bold: true })
  add(["comment.warning"], { fg: theme.warning, italic: true, bold: true })
  add(["comment.todo", "comment.note"], { fg: theme.info, italic: true, bold: true })
  add(["diff.plus"], { fg: theme.diffAdded, bg: theme.diffAddedBg })
  add(["diff.minus"], { fg: theme.diffRemoved, bg: theme.diffRemovedBg })
  add(["diff.delta"], { fg: theme.diffContext, bg: theme.diffContextBg })
  add(["error"], { fg: theme.error, bold: true })
  add(["warning"], { fg: theme.warning, bold: true })
  add(["info"], { fg: theme.info })
  return styles
}

export const SCANNER_INTERVAL_MS = 40
export const SCANNER_FRAME_COUNT = 54

/** Eight-cell block scanner: forward, end hold, backward, start hold. */
export function scannerFrame(frame: number) {
  const phase = frame % SCANNER_FRAME_COUNT
  const forward = phase < 17
  const holding = (phase >= 8 && phase < 17) || phase >= 24
  const position = phase < 8 ? phase : phase < 17 ? 7 : phase < 24 ? 23 - phase : 0
  const progress = phase < 8 ? phase : phase < 17 ? phase - 8 : phase < 24 ? phase - 17 : phase - 24
  const duration = holding ? forward ? 9 : 30 : forward ? 7 : 6
  const inactiveAlpha = 0.6 * (holding ? 1 - progress / duration * 0.7 : 0.3 + progress / duration * 0.7)
  return Array.from({ length: 8 }, (_, column) => {
    const distance = forward ? position - column : column - position
    const trail = holding ? distance + progress : distance
    const active = trail >= 0 && trail < 6
    return {
      character: active ? "■" : "⬝",
      alpha: !active ? inactiveAlpha : trail === 0 ? 1 : trail === 1 ? 0.9 : Math.pow(0.65, trail - 1),
      brightness: active && trail === 1 ? 1.15 : 1,
    }
  })
}
