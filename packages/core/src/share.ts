import { fromBase64, toBase64 } from "./base64"
import type { TagPath } from "./types"

export interface SharePayload {
  title: string
  source: string
  tags?: TagPath[]
}

/** Share links carry the diagram in the URL hash, so it never reaches a server. */
export const MAX_SHARE_HASH = 32_000
/** What a link may decompress to: well above Pele's 50,000-character source limit, so a small link can't inflate to megabytes. */
const MAX_SHARE_BYTES = 256 * 1024
const MAX_SHARE_TITLE = 1_000

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify({ v: 1, ...payload })
  const bytes = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"))
  const encoded = toBase64(bytes, "base64url")
  if (encoded.length > MAX_SHARE_HASH) throw new Error("This diagram is too large to share as a link.")
  return encoded
}

export async function decodeShare(encoded: string): Promise<SharePayload | null> {
  if (!encoded || encoded.length > MAX_SHARE_HASH) return null
  try {
    const bytes = await pipe(fromBase64(encoded, "base64url"), new DecompressionStream("deflate-raw"), MAX_SHARE_BYTES)
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload> & { v?: number }
    if (data.v !== 1 || typeof data.source !== "string") return null
    if (typeof data.title === "string" && data.title.length > MAX_SHARE_TITLE) return null
    return {
      title: typeof data.title === "string" ? data.title : "Shared diagram",
      source: data.source,
      tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
    }
  } catch {
    return null
  }
}

export function shareUrl(origin: string, encoded: string): string {
  return `${origin}/#/import?d=${encoded}`
}

/** Runs `input` through `stream`, throwing as soon as the output passes `max` bytes. */
async function pipe(input: Uint8Array, stream: CompressionStream | DecompressionStream, max = Infinity): Promise<Uint8Array> {
  const reader = new Blob([input as BlobPart]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.length
    if (size > max) {
      await reader.cancel()
      throw new Error(`Output is over ${max} bytes`)
    }
    chunks.push(read.value)
  }
  return new Blob(chunks as BlobPart[]).bytes()
}
