import path from "node:path"

export interface NotificationConfig {
  notify: boolean
  notifySound: boolean
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
  return { notify: boolean("notify"), notifySound: boolean("notifySound"), notificationSoundDirectory: directory }
}
