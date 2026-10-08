import type { NotificationConfig } from "./notification-config.js"
import { NotificationAudio } from "./notification-audio.js"
import { OwnedNotificationProcesses, type NotificationProcesses } from "./notification-process.js"
import { activateGnomeTerminal, gnomeTerminalIdentity, type TerminalIdentity } from "./notification-terminal.js"
import { notificationMarkup, notificationText, type NotificationBackend, type NotificationMessage } from "./notification-types.js"
import type { NotificationProcess } from "./notification-process.js"
import { NotificationIcon } from "./notification-icon.js"
import { uiText } from "./ui-text.js"

/** freedesktop/libnotify adapter. Action ownership is bounded to the banner lifetime. */
export class LinuxNotifications implements NotificationBackend {
  private stopped = false
  private abort = new AbortController()
  private audio: NotificationAudio
  private closers = new Set<() => void>()
  private closing = new Set<Promise<unknown>>()
  private icon = new NotificationIcon()
  private start(...args: Parameters<NotificationProcesses["start"]>): NotificationProcess | undefined {
    try { return this.processes.start(...args) } catch { return undefined }
  }
  constructor(config: NotificationConfig, private click: (sessionID: string) => void,
    private processes: NotificationProcesses = new OwnedNotificationProcesses(),
    private identity: TerminalIdentity | null = gnomeTerminalIdentity() ?? null,
    private platform: string = process.platform) {
    this.audio = new NotificationAudio(processes, config.notificationSoundDirectory)
  }
  async show(message: NotificationMessage, parent: AbortSignal) {
    if (this.stopped || parent.aborted || this.platform !== "linux") return
    const preparation = AbortSignal.any([parent, this.abort.signal])
    const [icon, soundReady] = await Promise.all([
      this.icon.file(preparation, message.kind),
      message.sound ? this.audio.ready(message.kind, preparation) : false,
    ])
    if (this.stopped || parent.aborted) return
    const local = new AbortController()
    const signal = AbortSignal.any([parent, local.signal, this.abort.signal])
    let id: string | undefined, closed = false, delivered = false, clicked = false, token: string | undefined
    let lateClose: ReturnType<typeof setTimeout> | undefined
    let withdrawn = false
    const withdraw = () => {
      if (!id || withdrawn) return
      withdrawn = true; clearTimeout(lateClose); local.abort()
      const process = this.start("gdbus", ["call", "--session", "--dest", "org.freedesktop.Notifications",
        "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.CloseNotification", id],
        1500, new AbortController().signal)
      if (process) {
        this.closing.add(process.result)
        void process.result.finally(() => this.closing.delete(process.result))
      }
    }
    const close = () => {
      if (closed) return
      closed = true
      this.closers.delete(close)
      if (id) withdraw()
      else lateClose = setTimeout(() => local.abort(), 1500)
    }
    this.closers.add(close)
    parent.addEventListener("abort", close, { once: true })
    const process = this.start("notify-send", [`--app-name=${uiText.notifications.application}`, ...(icon ? [`--icon=${icon}`] : []),
      // GNOME uses the desktop-entry's source icon, ignoring --icon there.
      // image-path supplies the separate image beside the notification heading.
      ...(icon ? [`--hint=string:image-path:${icon}`] : []),
      "--urgency=normal", "--expire-time=-1", "--transient", "--hint=boolean:suppress-sound:true", "--print-id",
      // GNOME emits an activation token only for a recognized application.
      ...(this.identity ? ["--hint=string:desktop-entry:org.gnome.Terminal"] : []),
      ...(this.identity ? [`--action=default=${uiText.notifications.openSession}`] : []), "--wait", "--",
      // Summaries are plain text; only the body supports desktop markup.
      uiText.notifications.heading(notificationText(message.body)).replaceAll("\\", "\\\\"),
      uiText.notifications.body(notificationMarkup(message.title)).replaceAll("\\", "\\\\")],
      120000, AbortSignal.any([local.signal, this.abort.signal]), line => {
        if (/^[1-9][0-9]{0,9}$/.test(line)) {
          id = line
          if (closed || signal.aborted) { withdraw(); return }
          if (!delivered) {
            delivered = true
            if (soundReady) void this.audio.play(message.kind, signal)
          }
        } else if (line === "default" && !closed && !signal.aborted) clicked = true
        else {
          const match = /^(?:\*\* )?\(notify-send:\d+\): (?:libnotify-)?DEBUG: [\d:.]+: Activation Token: ([\x21-\x7e]{1,4096})$/.exec(line)
          if (match) token = match[1]
        }
      })
    if (!process) { close(); parent.removeEventListener("abort", close); return }
    void process.result.then(() => {
      clearTimeout(lateClose)
      parent.removeEventListener("abort", close)
      // notify-send normally exits when the banner is dismissed. Do not send a
      // second CloseNotification for an already-expired ID (it could be reused).
      closed = true; this.closers.delete(close)
      // libnotify writes the token after the action name and closes its own
      // notification. Wait for EOF so token parsing is independent of chunking.
      if (clicked && !this.stopped) void activateGnomeTerminal(this.processes, this.identity, this.abort.signal, token).then(ok => {
        if (ok && !this.stopped) { try { this.click(message.sessionID) } catch {} }
      }).catch(() => {})
    })
    return { close, closed: process.result.then(() => {}) }
  }
  async dispose() {
    this.stopped = true
    for (const close of [...this.closers]) close()
    this.abort.abort()
    await Promise.allSettled([...this.closing, this.audio.dispose(), this.icon.dispose()])
    this.processes.dispose()
  }
}
