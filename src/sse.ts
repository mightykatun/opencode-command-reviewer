export const MAX_SSE_EVENT_BYTES = 65536
export const MAX_SSE_WIRE_BYTES = 4 * 1024 * 1024
export const MAX_SSE_EVENTS = 65536

export interface SSEEvent { data: string; event: string }

/** Bounded SSE framing, with UTF-8 decoding at line boundaries so a later malformed
 * byte cannot erase an already dispatched event from the same network chunk.
 * Limits include comments/unknown fields; blank records count toward the event limit.
 */
export class SSEParser {
  private decoder = new TextDecoder("utf-8", { fatal: true })
  private line = ""
  private data: string[] = []
  private event = ""
  private skipLF = false
  private crRecordBytes: number | undefined
  private wireBytes = 0
  private eventBytes = 0
  private events = 0
  private ended = false

  constructor(private readonly receive: (event: SSEEvent) => void) {}

  push(bytes: Uint8Array): void {
    if (this.ended) throw new Error("Reviewer SSE parser already ended")
    let start = 0
    for (let i = 0; i < bytes.length; i++) {
      if (++this.wireBytes > MAX_SSE_WIRE_BYTES) throw new Error("Reviewer SSE wire exceeds 4 MiB")
      const byte = bytes[i]!
      if (this.skipLF) {
        this.skipLF = false
        if (byte === 10) {
          // A CR dispatched the line already. Charge its paired LF to that record,
          // including a just-dispatched blank-line terminator, rather than the next one.
          const size = this.crRecordBytes === undefined ? ++this.eventBytes : this.crRecordBytes + 1
          if (size > MAX_SSE_EVENT_BYTES) throw new Error("Reviewer SSE event exceeds 64 KiB")
          this.crRecordBytes = undefined
          start = i + 1
          continue
        }
        this.crRecordBytes = undefined
      }
      if (++this.eventBytes > MAX_SSE_EVENT_BYTES) throw new Error("Reviewer SSE event exceeds 64 KiB")
      if (byte !== 10 && byte !== 13) continue
      const text = this.decode(bytes.subarray(start, i + 1))
      this.line += text.slice(0, -1)
      this.crRecordBytes = byte === 13 && !this.line ? this.eventBytes : undefined
      this.consumeLine()
      this.skipLF = byte === 13
      start = i + 1
    }
    if (start < bytes.length) this.line += this.decode(bytes.subarray(start))
  }

  finish(): void {
    if (this.ended) throw new Error("Reviewer SSE parser already ended")
    this.ended = true
    this.line += this.decode()
    // SSE never dispatches an unterminated final event. Reject it instead of silently
    // accepting trailing data after DONE or treating a partial DONE as completion.
    if (this.line || this.data.length || this.event) throw new Error("Reviewer SSE ended mid-event")
  }

  private decode(bytes?: Uint8Array): string {
    try { return this.decoder.decode(bytes, { stream: bytes !== undefined }) }
    catch { throw new Error("Reviewer SSE contains invalid UTF-8") }
  }

  private consumeLine(): void {
    const line = this.line
    this.line = ""
    if (!line) {
      if (++this.events > MAX_SSE_EVENTS) throw new Error("Reviewer SSE exceeds 65536 events")
      const event = { data: this.data.join("\n"), event: this.event || "message" }
      const dispatch = this.data.length > 0
      this.data = []
      this.event = ""
      this.eventBytes = 0
      if (dispatch) this.receive(event)
    } else if (!line.startsWith(":")) {
      const colon = line.indexOf(":")
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? "" : line.slice(colon + 1)
      if (value.startsWith(" ")) value = value.slice(1)
      if (field === "data") this.data.push(value)
      else if (field === "event") this.event = value
      // id/retry/unknown fields do not affect this non-reconnecting transport.
    }
  }
}
