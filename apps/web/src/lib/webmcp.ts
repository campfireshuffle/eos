import type { Eos } from "@eos/core"
import { createTools, registerTools, type UiBridge } from "@eos/webmcp"

import { download, svgMarkupToPng, themedSvg } from "./files"
import { changedVars, currentAppCss, DEFAULT_DIAGRAM_CSS } from "./theme"
import { diagramHref, homeHref, navigate, parseRoute } from "./router"
import { askConfirm, getUi, requestZoom, setUi } from "./ui-state"

/** Registers Eos's tools with WebMCP while the setting is on. */
export function connectWebMcp(eos: Eos): () => void {
  const ui: UiBridge = {
    origin: location.origin,
    getView: () => ({ route: parseRoute(location.hash), zoom: getUi().zoomScale, settingsOpen: getUi().settingsOpen }),
    openDiagram: (id) => navigate(diagramHref(id)),
    goHome: () => navigate(homeHref()),
    // Filters the agent leaves out, and the grouping and search it can't set, keep their current values.
    setLibraryView: ({ starred, deleted, tags, sort }) => {
      const current = parseRoute(location.hash)
      const view: Parameters<typeof homeHref>[0] = current.name === "home" ? { ...current } : {}
      if (starred !== undefined) view.starred = starred
      if (deleted !== undefined) view.deleted = deleted
      if (sort !== undefined) view.sort = sort
      if (tags !== undefined) view.tag = tags[0] ?? null
      navigate(homeHref(view))
    },
    setZoom: requestZoom,
    openSettings: (open) => setUi({ settingsOpen: open }),
    previewVersion: (id, version, meta) =>
      setUi({ preview: version ? { id, version, at: meta?.at ?? Date.now(), label: meta?.label ?? "" } : null }),
    // Checked before asking: a confirm while another dialog is open would be answered no without the person seeing it.
    confirm: async (message, action, signal) =>
      getUi().confirm ? "busy" : (await askConfirm(message, action, signal)) ? "confirmed" : "declined",
    download: (name, data) => download(name, data),
    toPng: svgMarkupToPng,
    toSvg: themedSvg,
    // Two frames covers React's render plus the preview's layout pass that applies zoom.
    settled: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    getTheme: () => ({
      resolvedMode: document.documentElement.classList.contains("dark") ? "dark" : "light",
      appCss: eos.getSettings().theme.customCss ?? currentAppCss(),
      diagramCss: eos.getSettings().theme.diagramCss ?? DEFAULT_DIAGRAM_CSS,
    }),
    // As Settings' Save does: on top of an override already saved, the CSS is the person's own, kept whole.
    appOverrides: (css) => (eos.getSettings().theme.customCss ? css : changedVars(css, currentAppCss())),
  }
  const tools = createTools(eos, ui)
  let unregister: (() => void) | null = null
  const sync = () => {
    const enabled = eos.getSettings().agent.webmcpEnabled
    if (enabled && !unregister) unregister = registerTools(tools)
    if (!enabled && unregister) {
      unregister()
      unregister = null
    }
  }
  sync()
  const off = eos.subscribe("settings", sync)
  return () => {
    off()
    unregister?.()
  }
}
