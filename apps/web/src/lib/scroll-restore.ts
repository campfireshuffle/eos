import { useEffect, useLayoutEffect, type RefObject } from "react"

import { currentEntry, onNavigate } from "./history"

/**
 * Remembers a scroll position per history entry and puts it back on back/forward,
 * like a browser does for whole pages. New navigations start at the top.
 *
 * `target` is the scrolling element, or null when the page itself scrolls (phones).
 * `ready` should turn true once the content is rendered, so there's height to restore into.
 */
const key = (i: number) => `eos-scroll:${i}`

export function useScrollRestoration(target: RefObject<HTMLElement | null> | null, ready: boolean, deps: unknown[] = []) {
  useLayoutEffect(() => {
    history.scrollRestoration = "manual"
  }, [])

  // Restore (or reset) whenever the entry changes and the content is in place.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let saving = false
    const el = () => target?.current ?? null
    const top = () => (el() ? el()!.scrollTop : window.scrollY)
    const scrollTo = (y: number) => (el() ? el()!.scrollTo({ top: y }) : window.scrollTo({ top: y }))

    const restore = () => {
      saving = false
      const { index, arrival } = currentEntry()
      const saved = arrival === "traverse" ? Number(sessionStorage.getItem(key(index)) ?? 0) : 0
      let tries = 0
      // Cards and thumbnails can still be laying out; retry briefly until the position fits.
      const attempt = () => {
        if (cancelled) return
        scrollTo(saved)
        if (Math.abs(top() - saved) > 2 && tries++ < 20) return void requestAnimationFrame(attempt)
        saving = true
      }
      attempt()
    }

    let frame = 0
    const onScroll = () => {
      if (!saving || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        sessionStorage.setItem(key(currentEntry().index), String(Math.round(top())))
      })
    }

    restore()
    const off = onNavigate(() => {
      // Freeze saving until the new entry's content is in place (the next run of this effect).
      saving = false
    })
    const scroller: EventTarget = el() ?? window
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelled = true
      off()
      cancelAnimationFrame(frame)
      scroller.removeEventListener("scroll", onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, target, ...deps])
}
