import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import wasmModule from "vite-plugin-wasm"

// vite-plugin-wasm is CommonJS; unwrap its default export under NodeNext resolution.
const wasm = ((wasmModule as unknown as { default?: typeof wasmModule }).default ?? wasmModule) as unknown as () => import("vite").Plugin

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  build: { target: "es2022" },
  optimizeDeps: { exclude: ["loro-crdt"] },
  worker: { format: "es", plugins: () => [wasm()] },
})
