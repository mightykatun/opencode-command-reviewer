// Real, isolated OpenCode TUI + deterministic local HTTP fixtures. No paid model.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, writeFile, access, copyFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as sleep } from "node:timers/promises"

const root = path.resolve(import.meta.dirname, "..")
const scenario = process.argv[2] ?? "correction"
assert.ok(["correction", "cancel", "error", "external"].includes(scenario))
const initialWidth = scenario === "cancel" ? 80 : 160
const formattedDescription = "Counts two fruit names.\n\n- **Output:** prints the count.\n- **File:** writes to `executed-marker`.\n- *Literal:* `\x1b[2J\u202e`.\n\n### Details\n\n[Documentation](https://example.com/review)"
const finalLine = "FINAL ANALYSIS LINE"
const longDescription = [formattedDescription, ...Array.from({ length: 60 }, (_, i) => `Analysis detail ${String(i + 1).padStart(2, "0")}.`), finalLine].join("\n\n")
const conversationDescription = "### Conversation heading\n\n**conversation_bold** *conversation_emphasis* `conversation_code`\n\n[conversation_link](https://example.com/conversation)"

function styleAt(ansi, text, index = ansi.indexOf(text)) {
  assert.ok(index >= 0, `styled text should contain ${text}`)
  const style = { fg: undefined, bg: undefined, bold: false, italic: false, underline: false }
  for (const match of ansi.slice(0, index).matchAll(/\x1b\[([\d;]*)m/g)) {
    const codes = match[1].split(";").map(Number)
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]
      if ((code === 38 || code === 48) && codes[i + 1] === 2) {
        style[code === 38 ? "fg" : "bg"] = codes.slice(i + 2, i + 5).join(",")
        i += 4
      } else if (code === 0) Object.assign(style, { fg: undefined, bg: undefined, bold: false, italic: false, underline: false })
      else if (code === 1 || code === 22) style.bold = code === 1
      else if (code === 3 || code === 23) style.italic = code === 3
      else if (code === 4 || code === 24) style.underline = code === 4
      else if (code === 39) style.fg = undefined
      else if (code === 49) style.bg = undefined
    }
  }
  return style
}

function assertConversationStyles(ansi) {
  for (const [review, conversation, emphasis] of [
    ["Output:", "conversation_bold", "bold"],
    ["Literal:", "conversation_emphasis", "italic"],
    ["Details", "Conversation heading", "bold"],
    ["Documentation", "conversation_link", "underline"],
    ["executed-marker", "conversation_code"],
  ]) {
    const actual = styleAt(ansi, review)
    const native = styleAt(ansi, conversation)
    assert.equal(actual.fg, native.fg, `${review} should use the conversation's theme color`)
    if (emphasis) assert.ok(actual[emphasis] && native[emphasis], `${review} should retain ${emphasis} formatting`)
    else {
      assert.equal(actual.bold, native.bold, "inline code should use the conversation's text weight")
      assert.equal(actual.italic, native.italic, "inline code should use the conversation's text emphasis")
    }
  }
}

// Fixture text before the scrollbar uses single-cell characters. Keep ANSI
// offsets so assertions inspect the rendered terminal colors, not plugin state.
function cellAt(ansi, row, column) {
  const lines = ansi.split("\n")
  const line = lines[row] ?? ""
  const start = lines.slice(0, row).reduce((sum, text) => sum + text.length + 1, 0)
  let x = 0
  for (const match of line.matchAll(/\x1b\][^\x1b\x07]*(?:\x1b\\|\x07)|\x1b\[[\d;]*m|./gu)) {
    if (match[0].startsWith("\x1b")) continue
    if (x++ === column) return { character: match[0], ...styleAt(ansi, match[0], start + match.index) }
  }
  // tmux trims trailing blanks but retains their final rendition/background.
  return { character: " ", ...styleAt(ansi, "", start + line.length) }
}

function assertScrollbarTheme(ansi) {
  const panel = styleAt(ansi, "Permission analysis").bg
  const muted = styleAt(ansi, "#").fg
  assert.ok(panel && muted && panel !== muted, "fixture needs distinct track and thumb colors")
  const cells = Array.from({ length: 34 }, (_, i) => cellAt(ansi, i + 5, 157))
  assert.ok(cells.some((cell) => /[█▀▄]/u.test(cell.character)), "overflow must render a scrollbar thumb")
  assert.ok(cells.some((cell) => cell.bg === panel && cell.character === " "), "scrollbar track should use the panel background")
  for (const cell of cells.filter((cell) => /[█▀▄]/u.test(cell.character))) {
    assert.equal(cell.fg, muted, "scrollbar thumb should use the active theme's muted text color")
    assert.equal(cell.bg, panel, "scrollbar thumb background should use the active panel color")
  }
  return { panel, muted }
}
const temp = await mkdtemp(path.join(tmpdir(), "opencode-command-reviewer-"))
// Load the built plugin away from the checkout to catch unbundled source assets.
const pluginFile = path.join(temp, "reviewer.mjs")
await copyFile(path.join(root, "dist/tui.js"), pluginFile)
const project = path.join(temp, "project")
await mkdir(project)
execFileSync("git", ["init", "--quiet", project])
const commandDirectory = scenario === "external" ? path.join(temp, "outside") : project
if (commandDirectory !== project) await mkdir(commandDirectory)
await mkdir(path.join(temp, "config"))
const source = 'from pathlib import Path\nfruits = ["apple", "pear"]\nprint(len(fruits))\nPath("executed-marker").write_text(str(len(fruits)))\n'
await writeFile(path.join(commandDirectory, "fruits.py"), source)
const calls = []
let toolSent = false
let reviewerCalls = 0
let reviewerAborted = false
let releaseReview
let reviewHeldAt
let releasedReviews = 0
const server = createServer(async (req, res) => {
  try {
    let text = ""
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    calls.push({ url: req.url, body })
    if (req.url === "/review/chat/completions") {
      assert.equal(req.headers.authorization, "Bearer fixture-review-key")
      reviewerCalls++
      if (scenario === "error") { res.writeHead(503); res.end("fixture outage"); return }
      const reply = () => {
        res.writeHead(200, { "Content-Type": "application/json" })
        const content = scenario === "correction" && reviewerCalls === 1
          ? '{"safe":"yes","desc":"Incorrect boolean type."}'
          : JSON.stringify({ safe: scenario !== "external", desc: scenario === "correction" ? longDescription : "Counts two fruit names, prints the count, and writes it to executed-marker." })
        res.end(JSON.stringify({ choices: [{ message: { content } }] }))
      }
      if (scenario === "cancel") {
        res.on("close", () => { if (!res.writableEnded) reviewerAborted = true })
        reviewHeldAt = Date.now()
        releaseReview = () => {
          assert.ok(reviewerAborted && res.destroyed, "release must follow observed client cancellation")
          releasedReviews++
          reply()
          releaseReview = undefined
        }
      } else reply()
      return
    }
    const tools = body.tools ?? []
    const tool = tools.find((item) => item.function?.name === "bash")
    const doTool = !!tool && !toolSent
    if (doTool) toolSent = true
    const message = doTool
      ? { role: "assistant", content: scenario === "correction" ? conversationDescription : null, tool_calls: [{ id: "call_fruits", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "python3 fruits.py", description: "Count fruit names", ...(scenario === "external" ? { workdir: "../outside" } : {}) }) } }] }
      : { role: "assistant", content: "Fixture complete." }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      const chunk = (delta, finish_reason) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })
      const delta = doTool
        ? { role: "assistant", content: message.content, tool_calls: message.tool_calls.map((t, index) => ({ index, ...t })) }
        : message
      res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`)
      res.write(`data: ${JSON.stringify(chunk({}, doTool ? "tool_calls" : "stop"))}\n\n`)
      res.end("data: [DONE]\n\n")
    } else {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message, finish_reason: doTool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    }
  } catch (error) {
    res.writeHead(500)
    res.end(String(error))
  }
})
const socket = `command-reviewer-${process.pid}`
const tmux = (...args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8" })
let screen = ""
let tmuxStarted = false
const failAfterListen = process.argv.includes("--fail-after-listen")
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  if (failAfterListen) throw new Error("Injected post-listen startup failure")
  const port = server.address().port
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: "fixture/fixture",
    small_model: "fixture/fixture",
    autoupdate: false,
    permission: { bash: "ask", external_directory: "ask" },
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: `http://127.0.0.1:${port}/main`, apiKey: "fixture-only" }, models: { fixture: { name: "Fixture", limit: { context: 32000, output: 1000 } } } } },
  }
  const tuiFile = path.join(temp, "tui.json")
  await writeFile(tuiFile, JSON.stringify({
    $schema: "https://opencode.ai/tui.json",
    theme: scenario === "correction" ? "tokyonight" : "opencode",
    plugin: [[pluginFile, { baseURL: `http://127.0.0.1:${port}/review`, model: "review-fixture", apiKey: "fixture-review-key" }]],
  }))
  const env = {
    HOME: temp,
    XDG_CONFIG_HOME: path.join(temp, "config"),
    XDG_DATA_HOME: path.join(temp, "data"),
    XDG_STATE_HOME: path.join(temp, "state"),
    XDG_CACHE_HOME: path.join(temp, "cache"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_CONFIG: "",
    OPENCODE_CONFIG_DIR: path.join(temp, "config"),
    OPENCODE_TUI_CONFIG: tuiFile,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  }
  await mkdir(path.join(root, ".runtime"), { recursive: true })
  tmuxStarted = true
  tmux("new-session", "-d", "-s", "smoke", "-x", String(initialWidth), "-y", scenario === "cancel" ? "24" : "40", "-c", project,
    "env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    process.env.OPENCODE_BIN ?? "opencode", project,
    "--prompt", "Count the fruit names in fruits.py using python3 fruits.py.")
  const capture = () => tmux("capture-pane", "-p", "-t", "smoke")
  const until = async (condition, timeout = 90000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await sleep(100)
      screen = capture()
      if (await condition(screen)) return
    }
    throw new Error("Timed out waiting for expected terminal state")
  }
  const expected = scenario === "error" ? "! Analysis unavailable" : scenario === "external" ? "! Unsafe" : "✓ Safe"
  const spinnerFrame = (s) => s.split("\n").find((line) => /[■⬝]{8}/.test(line.slice(initialWidth - 42)))?.match(/[■⬝]{8}/)?.[0]
  const hasExpected = (s) => scenario === "cancel" ? !!spinnerFrame(s) : s.includes(expected)
  const hasPanel = (s) => /Permission analysis|Counts two fruit names|Analysis unavailable/.test(s)
  const toggleSidebar = () => tmux("send-keys", "-t", "smoke", "C-x", "b")
  // SGR terminal mouse events enter the real host input path. Coordinates are
  // one-based; wheel = 64/65, left drag = press 0 / motion 32 / release 0.
  const mouse = (button, x, y, release = false) => tmux("send-keys", "-t", "smoke", "-l", `\x1b[<${button};${x};${y}${release ? "m" : "M"}`)
  const drag = async (from, to) => {
    mouse(0, 158, from)
    await sleep(100)
    const step = Math.sign(to - from)
    for (let y = from + step; step > 0 ? y <= to : y >= to; y += step) {
      mouse(32, 158, y)
      await sleep(20)
    }
    mouse(0, 158, to, true)
  }
  const wheelToEnd = async () => {
    for (let i = 0; i < 100 && !capture().includes(finalLine); i++) {
      mouse(65, 140, 20)
      await sleep(40)
    }
    await until((s) => s.includes(finalLine), 10000)
    assert.ok(!screen.includes("Counts two fruit names"), "wheel should move the analysis viewport")
    assert.match(screen, /Allow once.*Allow always.*Reject/, "native approval controls must survive scrolling")
  }
  const assertReviewLayout = (screen, width) => {
    const lines = screen.split("\n")
    const headingLine = lines.findIndex((line) => line.includes("Permission analysis"))
    assert.ok(headingLine >= 0, "permission analysis heading should be visible")
    const column = lines[headingLine].indexOf("Permission analysis")
    assert.equal(column, width - 40, "overlay heading should align with the native sidebar padding")
    const status = scenario === "cancel" ? spinnerFrame(screen) : expected
    assert.ok(status, "pending reviews should have an animated scanner")
    const reviewLine = lines.findIndex((line) => line.includes(status))
    assert.equal(reviewLine, headingLine + 2, "status should have its own line beneath the heading")
    assert.ok(screen.includes("Permission required"), "native permission should remain visible")
    assert.equal(lines[reviewLine].indexOf(status), column, "status should align with the heading")
    const controlsLine = lines.findIndex((line) => line.includes("Allow once"))
    assert.ok(controlsLine > headingLine, "native approval controls should remain visible beside the overlay")
    assert.equal(lines.filter((line) => line.includes(status)).length, 1, "review must not be duplicated in a bottom bar")
    const sidebarText = lines.map((line) => line.slice(width - 42)).join("\n")
    assert.doesNotMatch(sidebarText, /\b(?:SAFE|UNSAFE)\b/, "rating labels should use title case")
    assert.doesNotMatch(sidebarText, /Analyzing|\.\.\./, "the loading indicator should not include redundant text")
    assert.doesNotMatch(sidebarText, /Context|LSP|OpenCode|project:main|Fixture complete\./, "overlay must cover the native sidebar title, sections, and footer")
    if (scenario === "correction" || scenario === "external") {
      assert.equal(lines.findIndex((line) => line.includes("Counts two fruit names")), reviewLine + 2, "analysis should follow the status on a separate line")
    } else {
      assert.doesNotMatch(sidebarText, /✓ Safe|! Unsafe/, "pending or failed reviews must not fabricate a rating")
    }
    if (scenario === "error") assert.match(sidebarText, /Reviewer HTTP 503/)
    if (scenario === "correction") {
      assert.ok(screen.includes("Output: prints the count."), "formatted list should be visible")
      assert.ok(screen.includes("File: writes to executed-marker."), "inline code should render without backticks")
      assert.ok(!screen.includes("**Output:**"), "emphasis markers should be concealed")
      assert.ok(screen.includes("\\u001b[2J\\u202e"), "controls and bidi must stay escaped inside Markdown")
    }
  }
  const formattingReady = (s) => scenario === "correction"
    ? s.includes("File: writes to executed-marker.") && s.includes("\\u001b[2J\\u202e") && s.includes("Documentation")
    : scenario !== "external" || s.includes("Counts two fruit names")
  if (scenario === "cancel") {
    await until((s) => s.includes("Permission required") && reviewerCalls > 0)
    // Deliberately exceed the old six-second response race while the HTTP reply
    // remains held. This is a slow-UI regression, not a response synchronization.
    await sleep(6500)
    screen = capture()
    assert.ok(Date.now() - reviewHeldAt > 6000)
    assert.equal(releasedReviews, 0)
    assert.ok(releaseReview && !reviewerAborted, "review must remain pending throughout slow UI interaction")
    assert.ok(!hasPanel(screen) && !screen.includes("Context"), "a narrow terminal must not open the sidebar or show a bottom-bar fallback")
    await writeFile(path.join(root, ".runtime/cancel-sidebar-hidden.txt"), screen)
    toggleSidebar()
  }
  await until((screen) => screen.includes("Permission required") && hasExpected(screen) && formattingReady(screen) && reviewerCalls > 0)
  assertReviewLayout(screen, initialWidth)
  assert.match(screen, /Permission required/, "real native approval should be visible")
  assert.match(screen, /python3 fruits\.py/)
  assert.ok(hasExpected(screen), "review status should render alongside approval")
  assert.ok(!screen.includes("opencode-command-reviewer:"), "the plugin should not display a title header")
  const firstReview = calls.find((call) => call.url === "/review/chat/completions")
  assert.ok(firstReview)
  const sent = JSON.parse(firstReview.body.messages[1].content)
  assert.equal(sent.command, "python3 fruits.py")
  assert.equal(sent.cwd, commandDirectory)
  assert.equal(sent.userPrompt, "Count the fruit names in fruits.py using python3 fruits.py.")
  assert.equal(sent.files[0].contents, source)
  assert.equal(sent.session.root.directory, project)
  assert.equal(sent.session.root.projectID, sent.session.rootProject.id)
  assert.equal(sent.session.rootProject.worktree, project)
  assert.equal(sent.session.rootProject.vcs, "git")
  assert.equal(sent.execution.instanceDirectory, project)
  assert.equal(sent.execution.instanceWorktree, project)
  assert.equal(sent.execution.canonicalCwd, commandDirectory)
  assert.equal(sent.execution.requestedWorkdir, scenario === "external" ? "../outside" : null)
  assert.equal(sent.permission.type, scenario === "external" ? "external_directory" : "bash")
  await assert.rejects(access(path.join(commandDirectory, "executed-marker")), "plugin must not execute/approve the command")
  if (scenario === "correction") {
    assert.equal(reviewerCalls, 2)
    assert.match(calls.filter((call) => call.url === "/review/chat/completions")[1].body.messages[3].content, /Format validation failed/)
    assert.match(screen, /Counts two fruit names/)
    await sleep(400)
    assert.match(capture(), /Permission required/, "Safe must remain advisory")
  } else assert.equal(reviewerCalls, 1)
  await writeFile(path.join(root, `.runtime/${scenario}-pending.txt`), screen)
  const styledScreen = tmux("capture-pane", "-p", "-e", "-t", "smoke")
  await writeFile(path.join(root, `.runtime/${scenario}-pending.ansi`), styledScreen)
  assert.match(styledScreen.split("\n").find((line) => line.includes("Permission analysis")) ?? "", /\x1b\[1m/, "overlay heading should be bold")
  if (scenario === "correction" || scenario === "external") {
    assert.equal(styleAt(styledScreen, expected).fg, scenario === "correction" ? "195,232,141" : "245,167,66", "rating text and icon must use the selected theme's success/warning color")
  }
  if (scenario === "correction") {
    assertConversationStyles(styledScreen)
    const initialScrollbar = assertScrollbarTheme(styledScreen)
    assert.ok(!screen.includes(finalLine), "long analysis must initially overflow")
    await wheelToEnd()
    await writeFile(path.join(root, ".runtime/correction-wheel-final.txt"), screen)
    await drag(38, 6)
    await until((s) => formattingReady(s) && !s.includes(finalLine), 10000)
    await drag(6, 40)
    await until((s) => s.includes(finalLine), 10000)
    await writeFile(path.join(root, ".runtime/correction-drag-final.txt"), screen)
    await drag(38, 6)
    await until(formattingReady, 10000)
    tmux("resize-window", "-t", "smoke", "-x", "80", "-y", "24")
    await until((s) => s.includes("Permission required") && !hasPanel(s) && !s.includes("Context") && s.split("\n").length === 25)
    await writeFile(path.join(root, ".runtime/correction-sidebar-hidden.txt"), screen)
    toggleSidebar()
    await until((s) => s.includes(expected) && formattingReady(s) && s.includes("Permission analysis"), 10000)
    assertReviewLayout(screen, 80)
    await writeFile(path.join(root, ".runtime/correction-narrow-pending.txt"), screen)
    toggleSidebar()
    await until((s) => s.includes("Permission required") && !hasPanel(s) && !s.includes("Context"), 10000)
    tmux("resize-window", "-t", "smoke", "-x", "160", "-y", "40")
    await until((s) => s.includes("Permission required") && s.includes("enter confirm") && !hasPanel(s) && !s.includes("Context") && s.split("\n").length === 41)
    await writeFile(path.join(root, ".runtime/correction-wide-hidden.txt"), screen)
    toggleSidebar()
    await until((s) => s.includes(expected) && formattingReady(s) && s.includes("Permission analysis"), 10000)
    assertReviewLayout(screen, 160)
    tmux("send-keys", "-t", "smoke", "C-p")
    await until((s) => s.includes("Commands") && !hasPanel(s), 10000)
    await writeFile(path.join(root, ".runtime/correction-dialog.txt"), screen)
    tmux("send-keys", "-t", "smoke", "Escape")
    await until((s) => s.includes("Permission required") && s.includes(expected) && formattingReady(s), 10000)
    assertReviewLayout(screen, 160)
    tmux("send-keys", "-t", "smoke", "C-x", "t")
    await until((s) => s.includes("Themes") && !hasPanel(s), 10000)
    tmux("send-keys", "-t", "smoke", "-l", "opencode")
    await until((s) => s.includes("Themes") && s.includes("opencode"), 10000)
    tmux("send-keys", "-t", "smoke", "Enter")
    await until((s) => s.includes("Permission analysis") && s.includes(expected) && formattingReady(s), 10000)
    const changedTheme = tmux("capture-pane", "-p", "-e", "-t", "smoke")
    assertConversationStyles(changedTheme)
    const changedScrollbar = assertScrollbarTheme(changedTheme)
    assert.notEqual(changedScrollbar.panel, initialScrollbar.panel, "live theme change must update the track")
    assert.notEqual(changedScrollbar.muted, initialScrollbar.muted, "live theme change must update the thumb")
    assert.equal(styleAt(changedTheme, expected).fg, "127,216,143", "rating should follow a live theme change")
    assert.notEqual(styleAt(changedTheme, "executed-marker").fg, styleAt(styledScreen, "executed-marker").fg, "analysis code colors should update with the theme")
    await writeFile(path.join(root, ".runtime/correction-theme-changed.ansi"), changedTheme)
    await wheelToEnd()
    await writeFile(path.join(root, ".runtime/correction-theme-wheel-final.txt"), screen)
    tmux("send-keys", "-t", "smoke", "C-f")
    await until((s) => s.includes("Permission required") && s.includes("minimize"), 10000)
    await writeFile(path.join(root, ".runtime/correction-permission-fullscreen.txt"), screen)
    await writeFile(path.join(root, ".runtime/correction-permission-fullscreen.ansi"), tmux("capture-pane", "-p", "-e", "-t", "smoke"))
    assert.match(screen, /Allow once.*Allow always.*Reject/, "fullscreen native approval controls must remain visible")
    assert.match(screen, /python3 fruits\.py/, "fullscreen must retain the exact native command")
    assert.ok(!hasPanel(screen) && !screen.includes(finalLine), "native fullscreen portal should cover the analysis overlay")
    console.log("Native permission fullscreen layering: analysis covered; native command and all approval controls visible")
    tmux("send-keys", "-t", "smoke", "C-f")
    await until((s) => s.includes("Permission analysis") && s.includes("fullscreen") && !s.includes("minimize"), 10000)
    assert.equal(reviewerCalls, 2, "resizing or toggling the sidebar must not restart the review")
  }
  if (scenario === "external") {
    assert.match(screen, /! Unsafe/)
    assert.deepEqual(sent.permission.metadata.directories, [commandDirectory])
    assert.deepEqual(sent.permission.patterns, [`${commandDirectory}/*`])
    assert.deepEqual(sent.permission.always, [`${commandDirectory}/*`])
    // Authorize only the directory boundary. OpenCode must still ask for bash.
    tmux("send-keys", "-t", "smoke", "Enter")
    await until((s) => s.includes("Permission required") && s.includes("Shell command") && s.includes("! Unsafe") && formattingReady(s) && reviewerCalls === 2, 10000)
    const next = JSON.parse(calls.filter((call) => call.url === "/review/chat/completions")[1].body.messages[1].content)
    assert.equal(next.permission.type, "bash")
    assert.notEqual(next.permission.id, sent.permission.id)
    assert.equal(next.permission.tool.callID, sent.permission.tool.callID)
    assert.deepEqual(next.permission.patterns, ["python3 fruits.py"])
    assert.equal(next.cwd, commandDirectory)
    assert.equal(next.session.root.directory, project)
    assert.equal(next.files[0].contents, source)
    assertReviewLayout(screen, initialWidth)
    await assert.rejects(access(path.join(commandDirectory, "executed-marker")))
    await writeFile(path.join(root, ".runtime/external-bash-pending.txt"), screen)
  }
  if (scenario === "cancel") {
    const initialFrame = spinnerFrame(screen)
    await until((s) => !!spinnerFrame(s) && spinnerFrame(s) !== initialFrame, 1500)
    const loadingLine = styledScreen.split("\n")[3]
    for (const match of loadingLine.matchAll(/[■⬝]/g)) {
      const color = styleAt(loadingLine, match[0], match.index).fg?.split(",")
      assert.ok(color?.length === 3 && color[0] === color[1] && color[1] === color[2], "scanner cells should be gray")
    }
    tmux("send-keys", "-t", "smoke", "C-p")
    await until((s) => s.includes("Commands") && !hasPanel(s), 10000)
    tmux("send-keys", "-t", "smoke", "-l", "animations")
    await until((s) => s.includes("Disable animations"), 10000)
    tmux("send-keys", "-t", "smoke", "Enter")
    await until((s) => s.includes("Permission analysis") && s.includes("[⋯]"), 10000)
    assert.ok(!spinnerFrame(screen), "disabled animations should use a static indicator")
    assert.doesNotMatch(screen, /Analyzing/)
    await writeFile(path.join(root, ".runtime/cancel-static-indicator.txt"), screen)
    toggleSidebar()
    await until((s) => s.includes("Permission required") && !hasPanel(s) && !s.includes("Context"), 10000)
    assert.equal(reviewerCalls, 1, "hiding the sidebar must not restart the pending review")
  }
  // A real human-style keystroke, not a plugin/API permission write.
  tmux("send-keys", "-t", "smoke", scenario === "correction" ? "Enter" : "Escape")
  await until((s) => !s.includes("Permission required") && !hasPanel(s), 10000)
  if (scenario === "correction") {
    // The generated sidebar title can also be "Fixture complete." before bash
    // finishes. Observe execution, rather than mistaking that title for a reply.
    await until(async (s) => s.includes("Fixture complete.") && await access(path.join(commandDirectory, "executed-marker")).then(() => true, () => false), 10000)
    await access(path.join(commandDirectory, "executed-marker"))
  } else {
    if (scenario === "cancel") {
      await until(() => reviewerAborted, 10000)
      assert.equal(releasedReviews, 0, "HTTP abort must precede the held response release")
      releaseReview()
      assert.equal(releasedReviews, 1)
      await until((s) => s.includes("tab agents") && !s.includes("Permission required") && !hasPanel(s), 10000)
    } else await sleep(300)
    await assert.rejects(access(path.join(commandDirectory, "executed-marker")))
    assert.ok(!hasPanel(capture()), "late response must not resurrect panel")
  }
  if (scenario === "cancel") {
    toggleSidebar()
    await until((s) => s.includes("Context"), 10000)
    assert.ok(!hasPanel(screen), "reopening the sidebar after cancellation must not restore the review")
  }
  assert.match(capture(), /Context/, "native sidebar sections should remain after the temporary review is removed")
  await writeFile(path.join(root, `.runtime/${scenario}-resolved.txt`), capture())
  await writeFile(path.join(root, `.runtime/${scenario}-requests.json`), JSON.stringify(calls, null, 2))
  console.log(`PASS ${scenario}: native approval, exact evidence, advisory behavior, panel cleanup${scenario === "cancel" ? ", >6s held response, observed HTTP cancellation, released late response and clean sidebar remount at 80x24" : scenario === "correction" ? ", long-analysis wheel/drag, live scrollbar theme and native fullscreen layering" : ""}. Isolated files: ${temp}`)
} catch (error) {
  console.error(screen)
  console.error(`Isolated diagnostic files: ${temp}`)
  console.error(`Requests received: ${calls.length}`)
  throw error
} finally {
  if (tmuxStarted) { try { tmux("kill-server") } catch {} }
  releaseReview = undefined
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  assert.equal(server.listening, false, "fixture HTTP server must close even after startup failure")
  if (failAfterListen) console.log("PASS post-listen cleanup: fixture HTTP server closed")
}
