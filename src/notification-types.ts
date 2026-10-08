import { uiText } from "./ui-text.js"

export type NotificationKind = "attention" | "approved" | "error" | "ended"
export interface NotificationMessage {
  kind: NotificationKind
  title: string
  body: string
  sessionID: string
  sound: boolean
}
export interface NotificationHandle { close(): void | Promise<void>; closed?: Promise<void> }
export interface NotificationBackend {
  show(message: NotificationMessage, signal: AbortSignal): Promise<NotificationHandle | undefined>
  dispose(): void | Promise<void>
}
export interface NotificationClock {
  now(): number
  after(ms: number, callback: () => void): () => void
}
export const notificationClock: NotificationClock = {
  now: () => performance.now(),
  after: (ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) },
}

export function notificationText(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " "))
    .slice(0, 256).join("").trim() || uiText.notifications.fallbackSession
}

/** Desktop body-markup is not trusted to interpret conversation titles. */
export function notificationMarkup(value: string): string {
  return notificationText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
