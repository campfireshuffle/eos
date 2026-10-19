import { useSyncExternalStore } from "react"

/**
 * Tracks our position in the tab's history so back/forward only show when they
 * would stay inside Eos. Each entry is stamped with an index in history.state.
 */
const KEY = "eos-history-max"
let index = 0
let max = 0
const listeners = new Set<() => void>()

/** How we reached the current entry: a new navigation, or back/forward (and reloads). */
let arrival: "push" | "traverse" = "traverse"

function stamp() {
  const state = history.state as { eosIndex?: number } | null
  if (typeof state?.eosIndex === "number") {
    index = state.eosIndex
    arrival = "traverse"
  } else {
    arrival = "push"
    // A new entry: it becomes the newest, dropping any forward entries.
    index = sessionIndex() === null ? 0 : index + 1
    max = index
    history.replaceState({ ...(state ?? {}), eosIndex: index }, "")
  }
  max = Math.max(max, index)
  sessionStorage.setItem(KEY, String(max))
  listeners.forEach((l) => l())
}

function sessionIndex(): number | null {
  const v = sessionStorage.getItem(KEY)
  return v === null ? null : Number(v)
}

export function initHistory() {
  const saved = sessionIndex()
  const state = history.state as { eosIndex?: number } | null
  if (saved !== null && typeof state?.eosIndex === "number") {
    index = state.eosIndex
    max = saved
  } else {
    sessionStorage.removeItem(KEY)
    stamp()
  }
  window.addEventListener("hashchange", stamp)
  window.addEventListener("popstate", stamp)
}

let snapshot = { canGoBack: false, canGoForward: false }
function read() {
  const next = { canGoBack: index > 0, canGoForward: index < max }
  if (next.canGoBack !== snapshot.canGoBack || next.canGoForward !== snapshot.canGoForward) snapshot = next
  return snapshot
}

export function useHistoryNav() {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), read)
}

/** The current entry's position in this tab's history, and how we got there. */
export function currentEntry(): { index: number; arrival: "push" | "traverse" } {
  return { index, arrival }
}

/** Calls back after each navigation, once the entry has been stamped. */
export function onNavigate(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
