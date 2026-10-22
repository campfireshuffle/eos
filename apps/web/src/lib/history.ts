import { useSyncExternalStore } from "react"

// The tab's history, from the Navigation API. Its entries are only this origin's, so back/forward stay inside Eos.

// One listener calls back every subscriber, so React renders them all at once. With a listener each, a browser can run
// microtasks between them, and React renders a component on its own: Home with the new entry but the old route.
const listeners = new Set<() => void>()
navigation.addEventListener("currententrychange", () => listeners.forEach((cb) => cb()))

/** Calls back after each navigation, once the current entry and the URL have both changed. */
export function onNavigate(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export const useHistoryNav = () => ({
  canGoBack: useSyncExternalStore(onNavigate, () => navigation.canGoBack),
  canGoForward: useSyncExternalStore(onNavigate, () => navigation.canGoForward),
})

/** A key unique to the current entry: new for each new navigation, kept when the entry is replaced or gone back to. */
export const entryKey = () => navigation.currentEntry!.key

let current = { entry: "", hash: "" }
/** The current entry's key and its URL's hash, read from the entry together and kept as one object until either changes. */
function snapshot() {
  const { key, url } = navigation.currentEntry!
  const hash = new URL(url!).hash
  if (key !== current.entry || hash !== current.hash) current = { entry: key, hash }
  return current
}
export const useHistoryEntry = () => useSyncExternalStore(onNavigate, snapshot).entry
/** The URL's hash, from the same snapshot as useHistoryEntry, so a route and its entry always change together. */
export const useHash = () => useSyncExternalStore(onNavigate, snapshot).hash
