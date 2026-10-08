import type { NotificationProcesses } from "./notification-process.js"

export interface TerminalIdentity { service: string; screen: string }
export function gnomeTerminalIdentity(env: NodeJS.ProcessEnv = process.env): TerminalIdentity | undefined {
  // A terminal tab cannot identify a nested multiplexer pane or remote terminal.
  if (env.TMUX || env.STY || env.SSH_CONNECTION || env.SSH_TTY) return
  const service = env.GNOME_TERMINAL_SERVICE, path = env.GNOME_TERMINAL_SCREEN
  if (!service || !/^:[0-9]+\.[0-9]+$/.test(service) || !path) return
  const screen = /^\/org\/gnome\/Terminal\/screen\/([a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12})$/.exec(path)?.[1]
  return screen ? { service, screen: screen.replaceAll("_", "-") } : undefined
}

/** UUID-based GNOME Terminal selection, never title matching or a new window. */
export async function activateGnomeTerminal(processes: NotificationProcesses, identity: TerminalIdentity | undefined | null,
  signal: AbortSignal, token?: string): Promise<boolean> {
  if (!identity || signal.aborted) return false
  const base = ["call", "--session", "--dest", identity.service, "--object-path", "/org/gnome/Terminal/SearchProvider", "--method"]
  const check = processes.start("gdbus", [...base, "org.gnome.Shell.SearchProvider2.GetSubsearchResultSet", JSON.stringify([identity.screen]), "[]"], 1500, signal)
  const result = await check?.result
  if (signal.aborted || result?.code !== 0 || !result.stdout.includes(`'${identity.screen}'`)) return false
  if (token && /^[\x21-\x7e]{1,4096}$/.test(token)) {
    // GTK 3 before_emit installs desktop-startup-id in the Wayland display.
    // GNOME Terminal's Activate handler is a no-op; the following UUID-based
    // SearchProvider call presents the exact surface and consumes that token.
    const platform = `{'desktop-startup-id': <${JSON.stringify(token)}>, 'activation-token': <${JSON.stringify(token)}>}`
    const prepare = processes.start("gdbus", ["call", "--session", "--dest", identity.service,
      "--object-path", "/org/gnome/Terminal", "--method", "org.gtk.Application.Activate", platform], 1500, signal)
    if ((await prepare?.result)?.code !== 0 || signal.aborted) return false
  }
  const activation = processes.start("gdbus", [...base, "org.gnome.Shell.SearchProvider2.ActivateResult", identity.screen, "[]", "0"], 1500, signal)
  return (await activation?.result)?.code === 0 && !signal.aborted
}
