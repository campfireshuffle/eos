import { useCallback, useLayoutEffect, useRef, type RefObject } from "react"

const storageKey = (entry: string) => `eos-scroll:${entry}`

/** For a search typed into the search box: the entry's view starts at the top the next time its position is put back. */
export const startTypedSearchAtTop = (entry: string) => sessionStorage.setItem(storageKey(entry), "typed")

/**
 * Remembers a scroll position per history entry and puts it back on back/forward,
 * like a browser does for whole pages. A new entry has nothing saved, so it starts at
 * the top; replacing the entry (sort, group, search) keeps it, and so keeps the position.
 *
 * `target` is the scrolling element, or null when the page itself scrolls (phones).
 * `view` names what the entry shows (filter, group and sort) while the content on screen is for it; null while it isn't.
 * `drawn` says this render's content is the view's in full, as an empty view's is. Otherwise, call the function this
 * returns in each commit that draws the view in full (useGridDrawn), as content can be drawn a render after it's handed.
 *
 * Invariant: the entry's position is put back once per view it shows (and per scroller, as phones and desktop scroll
 * different elements), in the first commit that draws that view in full, and only from then are its scrolls saved. A
 * change within the view (an edit, another tab) never puts it back again.
 */
export function useScrollRestoration(target: RefObject<HTMLElement | null> | null, entry: string, view: string | null, drawn: boolean) {
  // What was last put back: the entry, the view, and whether the page scrolls rather than a pane.
  const restored = useRef<string>(undefined)
  const marker = view === null ? null : JSON.stringify([entry, view, !target])
  // The phone's second try at a typed search's top, until it runs.
  const frame = useRef(0)

  const put = useCallback(() => {
    if (marker === null || restored.current === marker) return
    restored.current = marker
    const scroller = target?.current ?? window
    const saved = sessionStorage.getItem(storageKey(entry))
    const restore = () => scroller.scrollTo({ top: Number(saved) || 0 })
    restore()
    // After typing, WebKit reveals the search box's caret before the next frame, from where the box was before this
    // scroll: in the phone's sticky header, that scrolls the page back down. So a typed search's page goes to the top
    // again in the next frame. Tracked in https://github.com/campfireshuffle/eos/issues/23; delete this once fixed.
    cancelAnimationFrame(frame.current)
    if (!target && saved === "typed") frame.current = requestAnimationFrame(restore)
  }, [marker, target, entry])

  // Before paint, so a view never shows at the wrong position, nor takes a scroll before its own is put back.
  useLayoutEffect(() => {
    history.scrollRestoration = "manual"
    if (drawn) put()
    const el = target?.current ?? null
    const save = () =>
      restored.current === marker && sessionStorage.setItem(storageKey(entry), String(Math.round(el ? el.scrollTop : scrollY)))
    const scroller = el ?? window
    scroller.addEventListener("scroll", save, { passive: true })
    return () => scroller.removeEventListener("scroll", save)
  }, [drawn, put, marker, target, entry])
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), [])

  return put
}
