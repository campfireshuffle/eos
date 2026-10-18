import { defineConfig } from "cf/config"

// Static SPA on Workers. The Cloudflare Vite plugin serves the client build as assets.
export default defineConfig({
  worker: {
    name: "eos",
    compatibilityDate: "2026-10-01",
    assets: {
      notFoundHandling: "single-page-application",
    },
    domains: ["eos.lil.run"],
  },
})
