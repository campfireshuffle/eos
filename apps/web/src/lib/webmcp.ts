import type { Eos } from "@eos/core"
import { createTools, registerTools, type UiBridge } from "@eos/webmcp"

import { download, svgMarkupToPng } from "./files"
import { currentAppCss, DEFAULT_DIAGRAM_CSS } from "./theme"
import { diagramHref, homeHref, navigate, parseRoute } from "./router"
import { askConfirm, getUi, requestZoom, setUi } from "./ui-state"

/** Registers Eos's tools with WebMCP while the setting is on. */
export function connectWebMcp(eos: Eos): () => void {
  const ui: UiBridge = {
    origin: location.origin,
    getView: () => ({ route: parseRoute(location.hash), zoom: getUi().zoomScale, settingsOpen: getUi().settingsOpen }),
    openDiagram: (id) => navigate(diagramHref(id)),
    goHome: () => navigate(homeHref()),
    setLibraryView: ({ starred, deleted, tags, sort }) => navigate(homeHref({ starred, deleted, tag: tags?.[0] ?? null, sort })),
    setZoom: requestZoom,
    openSettings: (open) => setUi({ settingsOpen: open }),
    previewVersion: (id, version, meta) =>
      setUi({ preview: version ? { id, version, at: meta?.at ?? Date.now(), label: meta?.label ?? "" } : null }),
    confirm: askConfirm,
    download: (name, data) => download(name, data),
    toPng: svgMarkupToPng,
    // Two frames covers React's render plus the preview's layout pass that applies zoom.
    settled: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    getTheme: () => ({
      resolvedMode: document.documentElement.classList.contains("dark") ? "dark" : "light",
      appCss: eos.getSettings().theme.customCss ?? currentAppCss(),
      diagramCss: eos.getSettings().theme.diagramCss ?? DEFAULT_DIAGRAM_CSS,
    }),
  }
  const tools = createTools(eos, ui)
  let unregister: (() => void) | null = null
  const sync = () => {
    const enabled = eos.getSettings().agent.webmcpEnabled
    if (enabled && !unregister) unregister = registerTools(tools)
    if (!enabled && unregister) (unregister(), (unregister = null))
  }
  sync()
  const off = eos.subscribe("settings", sync)
  return () => {
    off()
    unregister?.()
  }
}
