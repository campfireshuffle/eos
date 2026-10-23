import { createContext, useSyncExternalStore } from "react"

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

/** The `info` an agent's navigation carries, so it leaves the person's focus where it is. */
export const BY_AGENT = "agent"

/**
 * Each history entry is a page. Arriving at another entry (a push, or back/forward) swaps the page, and focus goes to
 * the new page's title (see PageHeader). A replace keeps the entry, so the page is the same one, changed in place (a
 * search typed, a sort, a tag renamed under it), and focus stays. An agent's navigation never moves the person's focus.
 * This is the entry whose title is still to take focus, once it's on screen.
 */
let focusPending: string | null = null
let byAgent = false
navigation.addEventListener("navigate", (e) => (byAgent = e.info === BY_AGENT))
navigation.addEventListener("currententrychange", (e) => {
  focusPending = e.from.key !== entryKey() && !byAgent ? entryKey() : null
})

/**
 * The entry of the page on screen, from the snapshot its route was rendered from. A component reading the entry for
 * itself would subscribe on its own, and a browser can render it, between listeners, ahead of the route.
 */
export const PageEntry = createContext("")

/** Whether the page at `entry` is to take focus now: true once per arrival. */
export function takeFocus(entry: string) {
  if (focusPending !== entry) return false
  focusPending = null
  return true
}

/**
 * The current entry's key and its URL's hash, read together from one snapshot. Pass both down from one component, so a
 * route and its entry always render together.
 */
export function useHistoryEntry() {
  // A hash has no spaces: the URL percent-encodes them.
  const [entry, hash] = useSyncExternalStore(onNavigate, () => `${entryKey()} ${new URL(navigation.currentEntry!.url!).hash}`).split(" ")
  return { entry, hash }
}
