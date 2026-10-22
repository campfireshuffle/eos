import { useSyncExternalStore } from "react"

// The tab's history, from the Navigation API. Its entries are only this origin's, so back/forward stay inside Eos.

/** Calls back after each navigation, once the current entry and the URL have both changed. */
export function onNavigate(cb: () => void) {
  navigation.addEventListener("currententrychange", cb)
  return () => navigation.removeEventListener("currententrychange", cb)
}

export const useHistoryNav = () => ({
  canGoBack: useSyncExternalStore(onNavigate, () => navigation.canGoBack),
  canGoForward: useSyncExternalStore(onNavigate, () => navigation.canGoForward),
})

/** A key unique to the current entry: new for each new navigation, kept when the entry is replaced or gone back to. */
export const entryKey = () => navigation.currentEntry!.key
export const useHistoryEntry = () => useSyncExternalStore(onNavigate, entryKey)
