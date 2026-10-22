import { useEffect, useLayoutEffect, type RefObject } from "react"

import { useHistoryEntry } from "./history"

/**
 * Remembers a scroll position per history entry and puts it back on back/forward,
 * like a browser does for whole pages. A new entry has nothing saved, so it starts at
 * the top; replacing the entry (sort, group, search) keeps it, and so keeps the position.
 *
 * `target` is the scrolling element, or null when the page itself scrolls (phones).
 * `ready` should turn true once the content is rendered, so there's height to restore into.
 * `deps` name what's shown, so the position is put back once a new view has rendered.
 */
export function useScrollRestoration(target: RefObject<HTMLElement | null> | null, ready: boolean, deps: unknown[] = []) {
  const entry = useHistoryEntry()

  useLayoutEffect(() => {
    history.scrollRestoration = "manual"
  }, [])

  useEffect(() => {
    if (!ready) return
    const key = `eos-scroll:${entry}`
    let cancelled = false
    let saving = false
    const el = () => target?.current ?? null
    const top = () => (el() ? el()!.scrollTop : window.scrollY)
    const scrollTo = (y: number) => (el() ? el()!.scrollTo({ top: y }) : window.scrollTo({ top: y }))

    // Without the Navigation API every entry has the key "", so nothing is kept and each view starts at the top.
    const saved = entry ? Number(sessionStorage.getItem(key) ?? 0) : 0
    let tries = 0
    // Cards and thumbnails can still be laying out; retry briefly until the position fits.
    const restore = () => {
      if (cancelled) return
      scrollTo(saved)
      if (Math.abs(top() - saved) > 2 && tries++ < 20) return void requestAnimationFrame(restore)
      saving = true
    }
    restore()

    const onScroll = () => {
      if (saving && entry) sessionStorage.setItem(key, String(Math.round(top())))
    }
    const scroller: EventTarget = el() ?? window
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelled = true
      scroller.removeEventListener("scroll", onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, target, entry, ...deps])
}
