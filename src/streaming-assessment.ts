import type { Assessment } from "./types.js"

export const MAX_ASSESSMENT_BYTES = 65536
export class AssessmentFormatError extends Error {}

type State = "start" | "first-key" | "key" | "key-string" | "colon" | "value" | "boolean" | "desc-string" | "after-value" | "done"
const whitespace = (char: string) => char === " " || char === "\t" || char === "\r" || char === "\n"
const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }

/** Single-pass lexer for the fixed two-field contract. Syntax failures are retained until
 * finish(), so transport can still consume terminal usage. Resource limits fail immediately.
 * Previews contain decoded Unicode scalar prefixes, never unfinished escapes/surrogates.
 */
export class StreamingAssessment {
  private state: State = "start"
  private error?: AssessmentFormatError
  private parts: string[] = []
  private bytes = 0
  private byteHigh = false
  private fields = new Set<string>()
  private key = ""
  private text = ""
  private escaped = false
  private unicode: string | undefined
  private high = ""
  private literal = ""
  private literalIndex = 0
  private value: Partial<Assessment> = {}

  get content(): string { return this.parts.join("") }
  preview(): Partial<Assessment> | undefined { return this.error ? undefined : { ...this.value } }

  push(chunk: string): void {
    // Account for a literal surrogate pair split between content deltas without counting it twice.
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i)
      this.bytes += this.byteHigh && code >= 0xdc00 && code <= 0xdfff ? 1 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3
      this.byteHigh = code >= 0xd800 && code <= 0xdbff
      if (this.bytes > MAX_ASSESSMENT_BYTES) throw new Error("Reviewer assessment exceeds 64 KiB")
      if (this.error) continue
      try { this.character(chunk[i]!) }
      catch (error) {
        if (!(error instanceof AssessmentFormatError)) throw error
        this.error = error
      }
    }
    if (chunk) this.parts.push(chunk)
  }

  finish(): Assessment {
    if (this.error) throw this.error
    if (this.state !== "done") throw new AssessmentFormatError("Invalid JSON")
    if (this.fields.size !== 2 || typeof this.value.safe !== "boolean" || !this.value.desc?.trim()) {
      throw new AssessmentFormatError("Invalid assessment fields or types")
    }
    return { safe: this.value.safe, desc: this.value.desc.trim() }
  }

  private invalid(): never { throw new AssessmentFormatError("Invalid JSON") }
  private schema(): never { throw new AssessmentFormatError("Invalid assessment fields or types") }

  private decoded(char: string): void {
    const code = char.charCodeAt(0)
    if (this.high) {
      if (code < 0xdc00 || code > 0xdfff) this.invalid()
      this.text += this.high + char
      this.high = ""
    } else if (code >= 0xd800 && code <= 0xdbff) {
      this.high = char
      return
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) this.invalid()
      this.text += char
    }
    if (this.state === "desc-string") this.value.desc = this.text
  }

  private string(char: string): void {
    if (this.unicode !== undefined) {
      if (!/^[0-9a-fA-F]$/.test(char)) this.invalid()
      this.unicode += char
      if (this.unicode.length === 4) {
        this.decoded(String.fromCharCode(parseInt(this.unicode, 16)))
        this.unicode = undefined
      }
    } else if (this.escaped) {
      this.escaped = false
      if (char === "u") this.unicode = ""
      else if (Object.hasOwn(escapes, char)) this.decoded(escapes[char]!)
      else this.invalid()
    } else if (char === "\\") this.escaped = true
    else if (char === '"') {
      if (this.high) this.invalid()
      if (this.state === "key-string") {
        if (this.fields.has(this.text)) throw new AssessmentFormatError("Duplicate assessment field")
        if (this.text !== "safe" && this.text !== "desc") this.schema()
        this.key = this.text
        this.fields.add(this.key)
        this.state = "colon"
      } else this.state = "after-value"
    } else {
      if (char.charCodeAt(0) < 0x20) this.invalid()
      this.decoded(char)
    }
  }

  private character(char: string): void {
    if (this.state === "key-string" || this.state === "desc-string") { this.string(char); return }
    if (this.state === "boolean") {
      if (this.literalIndex < this.literal.length) {
        if (char !== this.literal[this.literalIndex++]) this.invalid()
        return
      }
      // A complete spelling alone is not a token boundary (truex must never preview Safe).
      if (!whitespace(char) && char !== "," && char !== "}") this.invalid()
      this.value.safe = this.literal === "true"
      this.state = "after-value"
    }
    if (whitespace(char)) return
    switch (this.state) {
      case "start":
        if (char !== "{") this.invalid()
        this.state = "first-key"
        return
      case "first-key":
        if (char === "}") { this.state = "done"; return }
        // Fall through: a trailing comma uses key, which cannot accept a closing brace.
      case "key":
        if (char !== '"') this.invalid()
        this.text = ""
        this.state = "key-string"
        return
      case "colon":
        if (char !== ":") this.invalid()
        this.state = "value"
        return
      case "value":
        if (this.key === "safe") {
          if (char !== "t" && char !== "f") this.schema()
          this.literal = char === "t" ? "true" : "false"
          this.literalIndex = 1
          this.state = "boolean"
        } else {
          if (char !== '"') this.schema()
          this.text = ""
          this.value.desc = ""
          this.state = "desc-string"
        }
        return
      case "after-value":
        if (char === ",") this.state = "key"
        else if (char === "}") this.state = "done"
        else this.invalid()
        return
      default: this.invalid()
    }
  }
}
