import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"

import { clearSelection, getSelection, setSelection } from "@/lib/selection"

/**
 * Drag on empty space to rubber-band select cards ([data-card-id]).
 * Hold ⇧ or ⌘ to add to the current selection. It sets the selection the cards' grid shows.
 */
export function Marquee({
  children,
  className,
  scrollerRef,
}: {
  children: ReactNode
  className?: string
  /** Receives the element, which is also the scroll container on desktop. */
  scrollerRef?: RefObject<HTMLDivElement | null>
}) {
  const own = useRef<HTMLDivElement>(null)
  const root = scrollerRef ?? own
  const box = useRef<HTMLDivElement>(null)
  // Bumped whenever the library re-renders (new or changed rows hand Marquee new children),
  // so a drag knows its cached card rects are stale. Selection changes don't re-render Marquee.
  const layout = useRef(0)
  useLayoutEffect(() => void layout.current++)

  // The cards' grid owns ⌘A and Esc while it has focus. Esc anywhere else on the page (the selection bar, the
  // library after a drag) also clears, except in a dialog or menu, where Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest?.("dialog, [role=dialog], [role=menu]")) clearSelection()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    // On touch, dragging empty space scrolls; selection starts with a long press on a card.
    if (e.button !== 0 || e.pointerType === "touch") return
    const target = e.target as HTMLElement
    if (target.closest("[data-card-id], a, button, input, select, textarea, [role=menu]")) return
    const el = root.current!
    const origin = el.getBoundingClientRect()
    // A press on the scrollbar scrolls; it isn't a selection.
    if (e.clientX >= origin.left + el.clientLeft + el.clientWidth || e.clientY >= origin.top + el.clientTop + el.clientHeight) return
    const start = { x: e.clientX - origin.left + el.scrollLeft, y: e.clientY - origin.top + el.scrollTop }
    const base = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(getSelection()) : new Set<string>()
    let moved = false
    let pointer = { x: e.clientX, y: e.clientY }
    let frame = 0
    // Card rects in scroll-content coordinates, which scrolling doesn't change. Measured on the
    // first frame, and again only after the library re-renders.
    let cards: { id: string; x: number; y: number; w: number; h: number }[] = []
    let measured = -1
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // Capture can fail for synthetic or already-released pointers; dragging still works without it.
    }

    // Runs at most once a frame, for the latest pointer position. Reads layout before writing the box.
    const update = () => {
      frame = 0
      // The library unmounted mid-drag (say, the person navigated away); there's nothing to select.
      const b = box.current
      if (!b) return
      const r = el.getBoundingClientRect()
      const cur = { x: pointer.x - r.left + el.scrollLeft, y: pointer.y - r.top + el.scrollTop }
      const rect = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) }
      if (!moved && rect.w + rect.h < 4) return
      moved = true
      if (measured !== layout.current) {
        measured = layout.current
        cards = [...el.querySelectorAll<HTMLElement>("[data-card-id]")].map((card) => {
          const c = card.getBoundingClientRect()
          return { id: card.dataset.cardId!, x: c.left - r.left + el.scrollLeft, y: c.top - r.top + el.scrollTop, w: c.width, h: c.height }
        })
      }
      const hits = new Set(base)
      for (const c of cards) if (c.x < rect.x + rect.w && c.x + c.w > rect.x && c.y < rect.y + rect.h && c.y + c.h > rect.y) hits.add(c.id)
      Object.assign(b.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` })
      b.hidden = false
      setSelection(hits)
    }
    const schedule = () => (frame ||= requestAnimationFrame(update))
    const move = (ev: PointerEvent) => {
      // The release can be missed (it happened outside the window, or a drag-and-drop took over).
      // A move with no button held means the gesture is over, so never keep drawing.
      if (ev.buttons === 0) return up()
      pointer = { x: ev.clientX, y: ev.clientY }
      schedule()
    }
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("scroll", schedule)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      window.removeEventListener("blur", up)
      // Apply the last position a pending frame would have drawn.
      if (frame) {
        cancelAnimationFrame(frame)
        update()
      }
      if (!moved && !base.size) clearSelection()
      if (box.current) box.current.hidden = true
    }
    el.addEventListener("pointermove", move)
    // Autoscroll and the wheel still scroll mid-drag, which moves the pointer through the content.
    el.addEventListener("scroll", schedule, { passive: true })
    // Listen for the release anywhere, not just over the library.
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    window.addEventListener("blur", up)
  }

  return (
    <div ref={root} tabIndex={-1} onPointerDown={onPointerDown} className={`relative ${className ?? ""}`}>
      {children}
      {/* Drawn from the drag handler rather than state, so moving it doesn't cost a React commit per frame. */}
      <div
        ref={box}
        hidden
        className="pointer-events-none absolute z-10 rounded-sm border border-[var(--eos-champagne)] bg-[color-mix(in_srgb,var(--eos-champagne)_10%,transparent)]"
      />
    </div>
  )
}
