import { useSyncExternalStore } from "react"

/** Small global store for UI state that agents can also drive (settings, zoom, confirms). */
interface UiState {
  settingsOpen: boolean
  settingsTab: "theming" | "mcp" | "storage" | "about"
  zoomRequest: { action: "in" | "out" | "fit" | "actual"; n: number } | null
  zoomScale: number
  /**
   * The in-page dialog on screen: a confirm, or with no `action`, a message to dismiss. It stays after it's answered
   * (`open: false`), so its text holds while it fades out. A new one replaces it, with a new `id`.
   *
   * Focus invariant: a dialog returns focus to what had focus when it was asked for (`opener`). If that was the
   * dialog fading out, focus goes to that dialog's own opener. If nothing had focus, focus is left alone.
   */
  confirm: {
    id: number
    open: boolean
    title: string
    message: string
    action: string | null
    resolve: (ok: boolean) => void
    opener: HTMLElement | null
  } | null
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
    () => select(state)
  )
}

let zoomN = 0
export function requestZoom(action: "in" | "out" | "fit" | "actual") {
  setUi({ zoomRequest: { action, n: ++zoomN } })
}

/**
 * Opens the confirm dialog. `action` labels the confirming (destructive) button.
 * If `signal` aborts (an agent cancelled its call), the dialog closes as a no.
 */
export function askConfirm(message: string, action = "Delete", signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const entry = showDialog({ title: "Confirm action", message, action, resolve })
    if (!entry) return
    signal?.addEventListener("abort", () => state.confirm?.id === entry.id && answerConfirm(false), { once: true })
  })
}

/** Tells the person why something they asked for couldn't be done. */
export function showAlert(title: string, message: string) {
  showDialog({ title, message, action: null, resolve: () => {} })
}

/** Answers the open dialog. It closes before resolving, so a confirm asked for in response sees nothing open. */
export function answerConfirm(ok: boolean) {
  const c = state.confirm
  if (!c?.open) return
  setUi({ confirm: { ...c, open: false } })
  c.resolve(ok)
}

let confirmN = 0
function showDialog(c: Pick<NonNullable<UiState["confirm"]>, "title" | "message" | "action" | "resolve">) {
  // One dialog at a time, and never swapped under the person's cursor: while one is open, another is answered no.
  if (state.confirm?.open) {
    c.resolve(false)
    return null
  }
  // The opener is recorded now, when the dialog is asked for: focus is still on the control, or on the dialog
  // fading out, and not yet dropped on <body>.
  const focused = document.activeElement
  const active = focused instanceof HTMLElement && focused !== document.body ? focused : null
  // Focus still in the dialog fading out means the person just answered it: go back to where that one came from.
  const opener = active?.closest("[role=alertdialog]") ? (state.confirm?.opener ?? null) : active
  const entry = { ...c, id: ++confirmN, open: true, opener }
  setUi({ confirm: entry })
  return entry
}
