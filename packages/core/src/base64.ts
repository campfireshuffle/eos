/**
 * Base64 for backups (standard alphabet) and share links (URL-safe, no padding).
 * Uses the browser's Uint8Array.toBase64/fromBase64 (Baseline 2025) and falls back
 * to btoa/atob where they're missing; both produce the same text, so old links and
 * backups decode either way.
 */
type Alphabet = "base64" | "base64url"

interface NativeBase64 {
  toBase64?(options?: { alphabet?: Alphabet; omitPadding?: boolean }): string
}
interface NativeBase64Ctor {
  fromBase64?(text: string, options?: { alphabet?: Alphabet }): Uint8Array
}

export function toBase64(bytes: Uint8Array, alphabet: Alphabet = "base64"): string {
  const native = bytes as Uint8Array & NativeBase64
  if (native.toBase64) return native.toBase64({ alphabet, omitPadding: alphabet === "base64url" })
  let binary = ""
  // Chunked so large snapshots don't build the string one character at a time.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const text = btoa(binary)
  return alphabet === "base64url" ? text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : text
}

export function fromBase64(text: string, alphabet: Alphabet = "base64"): Uint8Array {
  const native = Uint8Array as unknown as NativeBase64Ctor
  if (native.fromBase64) return native.fromBase64(text, { alphabet })
  const standard = alphabet === "base64url" ? text.replace(/-/g, "+").replace(/_/g, "/") : text
  return Uint8Array.from(atob(standard), (c) => c.charCodeAt(0))
}
