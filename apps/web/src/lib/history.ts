import { useLayoutEffect, useSyncExternalStore } from "react"

import { openerClosed } from "@workspace/ui/components/dialog"

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

/**
 * The current entry's id: new each time the entry changes, a replace included (a link to the page already shown). A
 * navigation that doesn't commit (a download, a cancelled one) leaves it as it was.
 */
export const entryId = () => navigation.currentEntry!.id

/** The `info` an agent's navigation carries. Not entry state: browsers copy that onto the next push. */
export const BY_AGENT = "agent"

/**
 * Each history entry is a page, and arriving at one owes it focus: on its heading (PageTitle), once that's on screen
 * and can take it. Arriving is a push or back/forward by the person; an agent's navigation owes nothing, as an agent
 * never moves the person's focus. A replace keeps the entry (a search typed, a sort, a tag renamed under it, an import
 * opening its diagram), so it leaves what's owed as it was. The page arrives as it renders (useHistoryEntry), so where
 * leaving the last page put focus (the phone's drawer handing it back as it closed) settles nothing. From then on,
 * what's owed is settled by the next focus anywhere: the heading taking it, the person moving it, or a dialog handing it
 * back to its opener. A dialog that can't hand it back, its opener in a dialog that has closed, owes it to the page.
 */
let owed: string | null = null
// Whose navigation this is, from its navigate event, which comes just before the entry changes.
let byAgent = false
navigation.addEventListener("navigate", (e) => (byAgent = e.info === BY_AGENT))
// The entry the person's last push or back/forward made current: owed focus once its page renders.
let arriving: string | null = null
navigation.addEventListener("currententrychange", (e) => {
  if (e.from.key !== entryKey()) arriving = byAgent ? null : entryKey()
})
document.addEventListener("focusin", () => (owed = null))
// A dialog whose opener is inside a dialog that has closed too (Settings opened from the phone's drawer, once the page
// changed under them) has nowhere to hand focus back. The page is owed it instead, so focus isn't lost. Caught on the
// window on the way down, so it's owed before PageTitle hears the same close on the document.
window.addEventListener("close", (e) => e.target instanceof HTMLDialogElement && openerClosed(e.target) && (owed = entryKey()), true)

/** Focuses `heading` if focus is owed to the page at `entry`. Inert under a modal, it can't, and stays owed. */
export function arrive(entry: string, heading: HTMLElement) {
  if (owed === entry) heading.focus({ preventScroll: true })
}

/**
 * The current entry's key and id, and its URL's hash, read together from one snapshot. Called once, at the root (App),
 * which passes them down, so a route and its entry always render together.
 */
export function useHistoryEntry() {
  // Neither a hash nor an id has spaces: the URL percent-encodes them.
  const [entry, id, hash] = useSyncExternalStore(
    onNavigate,
    () => `${entryKey()} ${entryId()} ${new URL(navigation.currentEntry!.url!).hash}`
  ).split(" ")
  // A new entry's page arrives as it renders. At the root this runs after every layout effect beneath it (React runs a
  // parent's after its children's), so the drawer left open on the last page has already closed and handed focus back.
  useLayoutEffect(() => {
    owed = arriving === entry ? entry : null
  }, [entry])
  return { entry, id, hash }
}
