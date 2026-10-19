import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"

import { clearSelection, getSelection, setSelection } from "@/lib/selection"

/**
 * Drag on empty space to rubber-band select cards ([data-card-id]).
 * Hold ⇧ or ⌘ to add to the current selection. Esc clears it.
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
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearSelection()
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
    const start = { x: e.clientX - origin.left + el.scrollLeft, y: e.clientY - origin.top + el.scrollTop }
    const base = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(getSelection()) : new Set<string>()
    let moved = false
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // Capture can fail for synthetic or already-released pointers; dragging still works without it.
    }

    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const cur = { x: ev.clientX - r.left + el.scrollLeft, y: ev.clientY - r.top + el.scrollTop }
      const rect = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) }
      if (!moved && rect.w + rect.h < 4) return
      moved = true
      setBox(rect)
      const hits = new Set(base)
      for (const card of el.querySelectorAll<HTMLElement>("[data-card-id]")) {
        const c = card.getBoundingClientRect()
        const cx = c.left - r.left + el.scrollLeft
        const cy = c.top - r.top + el.scrollTop
        if (cx < rect.x + rect.w && cx + c.width > rect.x && cy < rect.y + rect.h && cy + c.height > rect.y) hits.add(card.dataset.cardId!)
      }
      setSelection(hits)
    }
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
      if (!moved && !base.size) clearSelection()
      setBox(null)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
  }

  return (
    <div ref={root} onPointerDown={onPointerDown} className={`relative ${className ?? ""}`}>
      {children}
      {box && (
        <div
          className="pointer-events-none absolute z-10 rounded-sm border border-[var(--eos-champagne)] bg-[color-mix(in_srgb,var(--eos-champagne)_10%,transparent)]"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
    </div>
  )
}
