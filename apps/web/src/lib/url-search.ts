import { useRef, useState } from "react"

import { entryKey } from "./history"
import { homeHref, navigate, parseRoute } from "./router"

/**
 * The search box: the URL's search, with what the person has typed on top until it's written. Typing replaces the
 * history entry rather than adding one, at most every 150ms, as Safari throws once a page rewrites its URL more than
 * 100 times in 10 seconds.
 */
export function useUrlSearch(entry: string, q: string) {
  // Typing, with the entry and the URL's search it was typed over. It shows only while both still hold, so a search set
  // elsewhere (back/forward, an agent, a link) shows at once, and isn't written over.
  const [draft, setDraft] = useState<{ entry: string; base: string; q: string }>()
  const latest = useRef(draft)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const write = () => {
    const d = latest.current
    const now = parseRoute(location.hash)
    if (!d || d.q === d.base || d.entry !== entryKey() || now.name !== "home" || now.q !== d.base) return false
    navigate(homeHref({ ...now, q: d.q }), { replace: true })
    return true
  }
  // Writes now, then once more at the end of each 150ms that brought more typing. Once there's nothing left to write,
  // the typing is either in the URL or was typed over a URL since left, so it's dropped.
  const tick = () => {
    timer.current = write() ? setTimeout(tick, 150) : undefined
    if (!timer.current) setDraft((latest.current = undefined))
  }
  return {
    query: draft && draft.entry === entry && draft.base === q ? draft.q : q,
    type: (text: string) => {
      setDraft((latest.current = { entry, base: q, q: text }))
      if (!timer.current) tick()
    },
    // Leaving the box, e.g. to open a result, writes typing still due, so Back returns to it.
    flush: () => void write(),
  }
}
