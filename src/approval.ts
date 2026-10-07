import type { OpencodeClient, PermissionRequest } from "@opencode-ai/sdk/v2"

/** Deliberately exposes no reject, always, rule-writing or execution operation. */
export interface ApprovalTransport {
  list(signal: AbortSignal): Promise<PermissionRequest[]>
  once(request: PermissionRequest, signal: AbortSignal): Promise<void>
}

export function approvalTransport(client: OpencodeClient, directory: string): ApprovalTransport {
  // Both operations target the same local host instance, never a tool workdir.
  return {
    async list(signal) {
      const result = await client.permission.list({ directory }, { signal, throwOnError: true })
      if (!Array.isArray(result.data)) throw new Error("Pending permissions unavailable")
      return result.data
    },
    async once(request, signal) {
      const result = await client.permission.reply({ directory, requestID: request.id, reply: "once" }, { signal, throwOnError: true })
      if (result.data !== true) throw new Error("Permission reply unconfirmed")
    },
  }
}
