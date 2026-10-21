import { useSyncExternalStore } from "react"

/**
 * Tracks our position in the tab's history so back/forward only show when they
 * would stay inside Eos. Each entry is stamped in history.state with its index and
 * a key of its own; replacing an entry keeps both.
 */
type Stamp = { eosIndex: number; eosKey: string }

const KEY = "eos-history-max"
let index = 0
let max = 0
let key = ""
/** The URL hash when the entry was last stamped. */
let hash = ""
const listeners = new Set<() => void>()

function stamp() {
  const state = history.state as Partial<Stamp> | null
  if (typeof state?.eosIndex === "number") {
    index = state.eosIndex
    key = state.eosKey!
  } else {
    // A new entry: it becomes the newest, dropping any forward entries.
    index = sessionIndex() === null ? 0 : index + 1
    max = index
    key = Math.random().toString(36).slice(2)
    history.replaceState({ ...(state ?? {}), eosIndex: index, eosKey: key } satisfies Stamp, "")
  }
  max = Math.max(max, index)
  sessionStorage.setItem(KEY, String(max))
  hash = location.hash
  listeners.forEach((l) => l())
}

function sessionIndex(): number | null {
  const v = sessionStorage.getItem(KEY)
  return v === null ? null : Number(v)
}

export function initHistory() {
  const saved = sessionIndex()
  const state = history.state as Partial<Stamp> | null
  if (saved !== null && typeof state?.eosIndex === "number") {
    index = state.eosIndex
    key = state.eosKey!
    max = saved
    hash = location.hash
  } else {
    sessionStorage.removeItem(KEY)
    stamp()
  }
  // A hash navigation fires popstate and then hashchange. Stamping on hashchange moves to the new entry
  // and the new route in one update, so nothing renders the old route under the new entry.
  window.addEventListener("hashchange", stamp)
  // Back or forward between entries with the same URL fires popstate alone.
  window.addEventListener("popstate", () => location.hash === hash && stamp())
  // A plain click on a link to the page already shown does nothing. Firefox would otherwise replace the entry
  // with an unstamped one, without an event.
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a") : null
    if (a?.href === location.href && !a.target && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) e.preventDefault()
  })
}

/** Calls back after each navigation, once the entry is stamped and the route has changed. */
export const onNavigate = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb))

let snapshot = { canGoBack: false, canGoForward: false }
function read() {
  const next = { canGoBack: index > 0, canGoForward: index < max }
  if (next.canGoBack !== snapshot.canGoBack || next.canGoForward !== snapshot.canGoForward) snapshot = next
  return snapshot
}

export function useHistoryNav() {
  return useSyncExternalStore(onNavigate, read)
}

/** A key unique to the current history entry: new for each new navigation, the same when it's gone back to. */
export function useHistoryEntry(): string {
  return useSyncExternalStore(onNavigate, () => key)
}
