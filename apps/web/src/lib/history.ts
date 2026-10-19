import { useSyncExternalStore } from "react"

/**
 * Tracks our position in the tab's history so back/forward only show when they
 * would stay inside Eos. Each entry is stamped with an index in history.state.
 */
const KEY = "eos-history-max"
let index = 0
let max = 0
const listeners = new Set<() => void>()

function stamp() {
  const state = history.state as { eosIndex?: number } | null
  if (typeof state?.eosIndex === "number") {
    index = state.eosIndex
  } else {
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
