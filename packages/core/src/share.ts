import type { TagPath } from "./types"

export interface SharePayload {
  title: string
  source: string
  tags?: TagPath[]
}

/** Share links carry the diagram in the URL hash, so it never reaches a server. */
export const MAX_SHARE_HASH = 32_000

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify({ v: 1, ...payload })
  const bytes = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"))
  const encoded = toBase64Url(bytes)
  if (encoded.length > MAX_SHARE_HASH) throw new Error("This diagram is too large to share as a link.")
  return encoded
}

export async function decodeShare(encoded: string): Promise<SharePayload | null> {
  if (!encoded || encoded.length > MAX_SHARE_HASH) return null
  try {
    const bytes = await pipe(fromBase64Url(encoded), new DecompressionStream("deflate-raw"))
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload> & { v?: number }
    if (data.v !== 1 || typeof data.source !== "string") return null
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

async function pipe(input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([input as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
