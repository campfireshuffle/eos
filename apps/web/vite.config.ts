import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import wasmModule from "vite-plugin-wasm"

// vite-plugin-wasm is CommonJS; unwrap its default export under NodeNext resolution.
const wasm = ((wasmModule as unknown as { default?: typeof wasmModule }).default ?? wasmModule) as unknown as () => import("vite").Plugin

/** Fails the build when an inline script in index.html isn't allowed, by hash, in public/_headers' Content-Security-Policy. */
function cspHashes(): Plugin {
  return {
    name: "eos:csp-hashes",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const headers = readFileSync(resolve(import.meta.dirname, "public/_headers"), "utf8")
        for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
          const hash = `'sha256-${createHash("sha256").update(script).digest("base64")}'`
          if (!headers.includes(hash)) throw new Error(`index.html's inline script changed: put ${hash} in script-src in public/_headers`)
        }
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), cloudflare(), cspHashes()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "./src") },
      // loro-crdt's "browser" build fetches and compiles its wasm synchronously, freezing the
      // page while it downloads; the bundler build lets vite-plugin-wasm load it asynchronously.
      { find: /^loro-crdt$/, replacement: "loro-crdt/bundler" },
    ],
  },
  server: { port: 5173, strictPort: true },
  build: { target: "es2022" },
  optimizeDeps: { exclude: ["loro-crdt"] },
  worker: { format: "es", plugins: () => [wasm()] },
})
