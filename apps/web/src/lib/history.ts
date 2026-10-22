import { useSyncExternalStore } from "react"

/**
 * The tab's history, from the Navigation API. Its entries are only this origin's, so back/forward stay inside Eos.
 * Without it (Firefox before 147, Safari before 26.2) routing still follows the hash, but there's no back/forward
 * and every entry has the same key.
 */
export const nav = "navigation" in window ? navigation : undefined

/** Calls back after each navigation, once the current entry and the URL have both changed. */
export function onNavigate(cb: () => void) {
  const [target, type] = nav ? [nav, "currententrychange"] : [window, "hashchange"]
  target.addEventListener(type, cb)
  return () => target.removeEventListener(type, cb)
}

export const useHistoryNav = () => ({
  canGoBack: useSyncExternalStore(onNavigate, () => nav?.canGoBack ?? false),
  canGoForward: useSyncExternalStore(onNavigate, () => nav?.canGoForward ?? false),
})

/** A key unique to the current entry: new for each new navigation, kept when the entry is replaced or gone back to. */
export const entryKey = () => nav?.currentEntry?.key ?? ""
export const useHistoryEntry = () => useSyncExternalStore(onNavigate, entryKey)
