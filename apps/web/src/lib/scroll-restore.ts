import { useLayoutEffect, type RefObject } from "react"

const storageKey = (entry: string) => `eos-scroll:${entry}`

/** For a search typed into the search box: the entry's view starts at the top the next time its position is put back. */
export const startTypedSearchAtTop = (entry: string) => sessionStorage.setItem(storageKey(entry), "typed")

/**
 * Remembers a scroll position per history entry and puts it back on back/forward,
 * like a browser does for whole pages. A new entry has nothing saved, so it starts at
 * the top; replacing the entry (sort, group, search) keeps it, and so keeps the position.
 *
 * `target` is the scrolling element, or null when the page itself scrolls (phones).
 * `ready` should be true only while the content shown is this view's, so it has its full height: each time it turns
 * true, the entry's position is put back, and from then on its scrolls are saved.
 */
export function useScrollRestoration(target: RefObject<HTMLElement | null> | null, entry: string, ready: boolean) {
  // Before paint, so a view never shows at the wrong position, nor takes a scroll before its own is put back.
  useLayoutEffect(() => {
    history.scrollRestoration = "manual"
    if (!ready) return
    const el = target?.current ?? null
    const scroller = el ?? window
    const saved = sessionStorage.getItem(storageKey(entry))
    const restore = () => scroller.scrollTo({ top: Number(saved) || 0 })
    restore()
    // After typing, WebKit reveals the search box's caret before the next frame, from where the box was before this
    // scroll: in the phone's sticky header, that scrolls the page back down. So a typed search's page goes to the top
    // again in the next frame.
    const frame = !el && saved === "typed" ? requestAnimationFrame(restore) : 0
    const save = () => sessionStorage.setItem(storageKey(entry), String(Math.round(el ? el.scrollTop : window.scrollY)))
    scroller.addEventListener("scroll", save, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener("scroll", save)
    }
  }, [ready, target, entry])
}
