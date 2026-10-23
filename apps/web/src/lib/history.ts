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

/** The `info` an agent's navigation carries. Not entry state: browsers copy that onto the next push. */
export const BY_AGENT = "agent"

/**
 * Each history entry is a page, and arriving at one owes it focus: on its heading (PageTitle), once that's on screen
 * and can take it. Arriving is a push or back/forward by the person; an agent's navigation owes nothing, as an agent
 * never moves the person's focus. A replace keeps the entry (a search typed, a sort, a tag renamed under it, an import
 * opening its diagram), so it leaves what's owed as it was. What's owed is settled by the next focus anywhere: the
 * heading taking it, the person moving it, or a dialog handing it back to its opener.
 */
let owed: string | null = null
// Whose navigation this is, from its navigate event, which comes just before the entry changes.
let byAgent = false
navigation.addEventListener("navigate", (e) => (byAgent = e.info === BY_AGENT))
navigation.addEventListener("currententrychange", (e) => {
  if (e.from.key !== entryKey()) owed = byAgent ? null : entryKey()
})
document.addEventListener("focusin", () => (owed = null))

/** Focuses `heading` if focus is owed to the page at `entry`. Inert under a modal, it can't, and stays owed. */
export function arrive(entry: string, heading: HTMLElement) {
  if (owed === entry) heading.focus({ preventScroll: true })
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
