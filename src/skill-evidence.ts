import path from "node:path"
import type { FileEvidence, Limits, SkillContext, SkillEvidence } from "./types.js"
import { boundedCopy } from "./tool-evidence.js"
import { captureFile, withinDirectory } from "./evidence.js"
import { FileLimit, omittedFile } from "./files.js"
import { fileAccess, type FileScope } from "./file-access.js"
import { reviewStage } from "./deadline.js"

/** Literal references in main instructions only. No directory walks, expansion,
 * execution, external retrieval or recursive reading of supporting files. */
export function skillReferences(text: string, signal: AbortSignal) {
  const references = new Set<string>(), limitations = new Set<string>()
  const end = performance.now() + 250
  let tokens = 0
  const add = (raw: string, link = false) => {
    if (++tokens > 16384 || references.size >= 256 || performance.now() >= end) return false
    reviewStage(signal, "Skill reference discovery")
    let value = raw.trim()
    if (link) {
      if (value.startsWith("<") && !value.includes(">")) { limitations.add("An invalid skill file link was not resolved."); return true }
      value = value.startsWith("<") ? value.slice(1, value.indexOf(">")) : value.split(/\s+["']/)[0]!
      if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("#")) return true
      value = value.split("#", 1)[0]!
      try { value = decodeURIComponent(value) } catch { limitations.add("An invalid encoded skill file reference was not resolved."); return true }
    } else value = value.replace(/[,;:.!]$/, "")
    if (!value || value.endsWith("/")) return true
    const literalPath = value.includes("/") || /\.(?:mdx?|txt|rst|py|sh|bash|zsh|js|mjs|cjs|ts|tsx|json|ya?ml|toml|ini|cfg|conf|sql|xml|html|css|csv|ipynb|go|rs|rb|ps1|bat|wasm|so|exe)$/i.test(value)
    if (!link && !literalPath) return true
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//")) return true
    if (value.length > 4096 || /[\u0000-\u001f\u007f$*?{}\\]/.test(value) || value.startsWith("~")) {
      limitations.add("Dynamic, globbed or invalid skill file references were not resolved."); return true
    }
    references.add(value)
    return true
  }
  for (const match of text.matchAll(/`([^`\r\n]+)`|\]\(([^()[\]\r\n]+)\)|"([^"\r\n]+)"|'([^'\r\n]+)'|[^\s`"'<>()[\]{}]+/g)) {
    reviewStage(signal, "Skill reference discovery")
    const quoted = match[1] ?? match[3] ?? match[4]
    // Only recognizable inline commands split into operands. Quoted filenames
    // such as "my notes.md" stay whole; guessing their suffix would read a
    // different, unreferenced file.
    let complete = true
    const command = match[1] !== undefined && /^(?:(?:python(?:\d+(?:\.\d+)*)?|node|bun|deno|bash|sh|zsh|cat|head|source|uv|npx|git)\s|[^\s]+\.(?:py|sh|bash|js|mjs|ts)\s|\.{1,2}\/[^\s]+\s+--)/.test(quoted!)
    if (quoted && command) {
      for (const part of quoted.matchAll(/"([^"]+)"|'([^']+)'|[^\s]+/g)) {
        if (!add(part[1] ?? part[2] ?? part[0])) { complete = false; break }
      }
    } else complete = add(quoted ?? match[2] ?? match[0], match[2] !== undefined)
    if (!complete) { limitations.add("Skill reference discovery reached its bounded work limit; additional references were not inspected."); break }
  }
  return { references: [...references], limitations: [...limitations] }
}

export async function collectSkillEvidence(context: SkillContext, limits: Limits, signal: AbortSignal,
  scope: FileScope = fileAccess.scope(signal)): Promise<SkillEvidence> {
  reviewStage(signal, "Skill evidence collection")
  const skill = context.skill
  if (typeof skill?.content === "string" && skill.content.length > limits.maxEvidenceBytes) throw new Error("Complete skill instructions exceed configured evidence byte budget")
  if (!skill || typeof skill.name !== "string" || skill.name !== context.input.name || typeof skill.content !== "string"
    || !skill.content.trim() || skill.content.includes("\0") || typeof skill.location !== "string" || !skill.location
    || (skill.description !== undefined && typeof skill.description !== "string")) throw new Error("Complete host skill definition unavailable")
  const mandatory = boundedCopy({ tool: context.tool, input: context.input, permission: context.permission,
    skill: { name: skill.name, location: skill.location, content: skill.content,
      ...(skill.description === undefined ? {} : { description: skill.description }) } }, limits.maxEvidenceBytes)
  const discovery = skillReferences(skill.content, signal)
  const limitations = [...context.limitations,
    "Skill instructions are the host catalog snapshot. Only directly referenced local supporting files within the skill directory are inspected; directories, further references, imports and external URLs are not followed. No instructions or scripts were executed.",
    ...discovery.limitations]
  if (!context.userPrompt) limitations.push("User prompt unavailable.")
  let remaining = limits.maxEvidenceBytes - mandatory.bytes
  // The main catalog-supplied skill counts as one file, without rereading SKILL.md.
  const limit = new FileLimit(Math.max(0, limits.maxFiles - 1), scope)
  const files: FileEvidence[] = [], seen = new Set<string | symbol>()
  const base = path.isAbsolute(skill.location) && !skill.location.includes("\0") ? path.dirname(skill.location) : undefined
  const canonical = base && discovery.references.length ? await scope.canonical(base) : undefined
  if (discovery.references.length && !canonical?.path) limitations.push("Local skill directory unavailable; supporting files were not read.")
  for (const filename of discovery.references) {
    reviewStage(signal, "Skill supporting files")
    const declared = base ? path.isAbsolute(filename) ? filename : `${base}/${filename}` : undefined
    let file: FileEvidence = { filename, ...(declared ? { path: declared } : {}), status: "local skill directory unavailable" }
    if (base && declared && canonical?.path) {
      if (!withinDirectory(base, declared)) file.status = "outside the skill directory; contents not provided"
      else if (path.resolve(declared) === path.resolve(skill.location)) continue
      else {
        const { key, withinLimit } = await limit.consider(declared, signal)
        if (seen.has(key)) continue
        seen.add(key)
        file = withinLimit ? await captureFile({ filename, cwd: base, executable: false }, remaining, signal, scope, canonical.path)
          : { ...file, status: "file-count limit reached" }
      }
    }
    if (file.contents === undefined) file.warning = omittedFile(file.path ?? filename)
    else remaining -= Buffer.byteLength(file.contents)
    files.push(file)
  }
  signal.throwIfAborted()
  limitations.push(...limit.limitations)
  return { ...context, ...mandatory.value, files, partial: discovery.limitations.length > 0 || files.some(file => file.contents === undefined), limitations }
}
