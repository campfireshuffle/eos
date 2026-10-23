import { useLayoutEffect, useRef, type RefObject } from "react"

import { useHistoryEntry } from "./history"

/**
 * Remembers a scroll position per history entry and puts it back on back/forward,
 * like a browser does for whole pages. A new entry has nothing saved, so it starts at
 * the top; replacing the entry (sort, group, search) keeps it, and so keeps the position.
 *
 * `target` is the scrolling element, or null when the page itself scrolls (phones).
 * `ready` should be true only while the content shown is this view's, so there's the right height to restore into.
 * `deps` name what's shown, so the position is put back once a new view has rendered.
 */
export function useScrollRestoration(target: RefObject<HTMLElement | null> | null, ready: boolean, deps: unknown[] = []) {
  const entry = useHistoryEntry()

  useLayoutEffect(() => {
    history.scrollRestoration = "manual"
  }, [])

  // The view last put back. `ready` can turn false and back without the view changing (rows reloading for a search
  // typed into it); that resumes saving rather than putting the position back.
  const restored = useRef("")

  // Before paint, so a view never shows at the wrong position, nor takes a scroll before its own is put back.
  useLayoutEffect(() => {
    if (!ready) return
    const key = `eos-scroll:${entry}`
    const view = JSON.stringify([entry, ...deps])
    let cancelled = false
    let saving = restored.current === view
    const el = () => target?.current ?? null
    const top = () => (el() ? el()!.scrollTop : window.scrollY)
    const scrollTo = (y: number) => (el() ? el()!.scrollTo({ top: y }) : window.scrollTo({ top: y }))

    const saved = Number(sessionStorage.getItem(key) ?? 0)
    let tries = 0
    // Cards and thumbnails can still be laying out; retry briefly until the position fits.
    const restore = () => {
      if (cancelled) return
      scrollTo(saved)
      if (Math.abs(top() - saved) > 2 && tries++ < 20) return void requestAnimationFrame(restore)
      restored.current = view
      saving = true
    }
    const onScroll = () => {
      if (saving) sessionStorage.setItem(key, String(Math.round(top())))
    }
    // Scrolls while it wasn't ready weren't saved; the position now is the one to keep.
    if (saving) onScroll()
    else restore()
    const scroller: EventTarget = el() ?? window
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelled = true
      scroller.removeEventListener("scroll", onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, target, entry, ...deps])
}
