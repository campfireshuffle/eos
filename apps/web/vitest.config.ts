import { defineConfig } from "vitest/config"

// Unit tests are plain functions: they don't need vite.config.ts's Cloudflare, Tailwind or wasm plugins.
export default defineConfig({})
