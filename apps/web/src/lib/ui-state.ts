import { useSyncExternalStore } from "react"

/** Small global store for UI state that agents can also drive (settings, zoom, confirms). */
interface UiState {
  settingsOpen: boolean
  settingsTab: "theming" | "mcp" | "storage" | "about"
  zoomRequest: { action: "in" | "out" | "fit" | "actual"; n: number } | null
  zoomScale: number
  confirm: { message: string; action: string; resolve: (ok: boolean) => void } | null
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  /** A past version being previewed read-only in the editor. */
  preview: { id: string; version: string; at: number; label: string } | null
}

let state: UiState = {
  sidebarCollapsed: false,
  mobileNavOpen: false,
  preview: null,
  settingsOpen: false,
  settingsTab: "theming",
  zoomRequest: null,
  zoomScale: 1,
  confirm: null,
}
const listeners = new Set<() => void>()

export function setUi(patch: Partial<UiState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function getUi() {
  return state
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => select(state),
  )
}

let zoomN = 0
export function requestZoom(action: "in" | "out" | "fit" | "actual") {
  setUi({ zoomRequest: { action, n: ++zoomN } })
}

/** Opens the confirm dialog. `action` labels the confirming (destructive) button. */
export function askConfirm(message: string, action = "Delete"): Promise<boolean> {
  return new Promise((resolve) => setUi({ confirm: { message, action, resolve } }))
}
