import path from "node:path"
import { notificationKinds, type NotificationKind } from "./notification-types.js"

export interface NotificationControls { banner: boolean; sound: boolean }
export interface NotificationConfig {
  notify: boolean
  notifySound: boolean
  staleReminderSeconds: number
  notifications: Record<NotificationKind, NotificationControls>
  notificationSoundDirectory?: string
}

/** Parsed independently so a desktop setting cannot disable permission review. */
export function parseNotificationConfig(options: Record<string, unknown> = {}): NotificationConfig {
  const boolean = (name: string) => {
    const value = options[name] === undefined ? true : options[name]
    if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`)
    return value
  }
  const directory = options.notificationSoundDirectory
  if (directory !== undefined && (typeof directory !== "string" || !path.isAbsolute(directory)
    || directory.includes("\u0000") || directory.length > 4096)) {
    throw new Error("notificationSoundDirectory must be an absolute sound-directory path")
  }
  const seconds = options.staleReminderSeconds ?? 60
  if (options.staleReminderSeconds === null || typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error("staleReminderSeconds must be a nonnegative safe integer")
  }
  const object = (value: unknown, name: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${name} must be an object`)
    return value as Record<string, unknown>
  }
  const input = options.notifications === undefined ? {} : object(options.notifications, "notifications")
  for (const kind of Object.keys(input)) {
    if (!notificationKinds.some(value => value === kind)) throw new Error(`Unknown notification type: ${kind}`)
  }
  const notifications = Object.fromEntries(notificationKinds.map(kind => {
    const entry = Object.hasOwn(input, kind) ? object(input[kind], `notifications.${kind}`) : {}
    for (const key of Object.keys(entry)) if (key !== "banner" && key !== "sound") throw new Error(`Unknown notifications.${kind} setting: ${key}`)
    const control = (key: "banner" | "sound") => {
      const value = Object.hasOwn(entry, key) ? entry[key] : true
      if (typeof value !== "boolean") throw new Error(`notifications.${kind}.${key} must be a boolean`)
      return value
    }
    return [kind, { banner: control("banner"), sound: control("sound") }]
  })) as Record<NotificationKind, NotificationControls>
  return { notify: boolean("notify"), notifySound: boolean("notifySound"), staleReminderSeconds: seconds,
    notifications, notificationSoundDirectory: directory }
}
