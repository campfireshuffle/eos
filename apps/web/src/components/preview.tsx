import { mount, type Mounted } from "pele"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { setUi, useUi } from "@/lib/ui-state"

const MIN = 0.1
const MAX = 8

/**
 * Live Pele render with our own zoom: "fit" scales the diagram to the pane,
 * any other value is relative to the SVG's natural size (1 = 100%).
 * Keeps the last good diagram on screen while the source has errors.
 */
export function Preview({ source, valid, onSvg }: { source: string; valid: boolean; onSvg: (el: SVGSVGElement | null) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<Mounted | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [mode, setMode] = useState<"fit" | number>("fit")
  // w/h: the content area (for fitting). ow/oh: the outer size, which a scrollbar appearing doesn't change.
  const [box, setBox] = useState({ w: 0, h: 0, ow: 0, oh: 0 })
  const zoomRequest = useUi((s) => s.zoomRequest)
  // Ignore zoom requests made before this preview mounted (e.g. on another diagram).
  const handled = useRef(zoomRequest?.n ?? 0)

  // The last scale actually applied, and the current mode, for use inside render callbacks.
  const applied = useRef<number | null>(null)
  const modeRef = useRef<"fit" | number>("fit")
  // A point that should stay under the cursor or fingers across the next zoom change.
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null)
  /** Zooms to `next`, keeping the diagram point under (x, y) in place. */
  // The diagram point a zoom gesture is anchored to. While the cursor stays put, every step reuses it
  // instead of re-measuring, so whole-pixel scroll rounding can't accumulate into drift.
  const zoomGesture = useRef<{ fx: number; fy: number; x: number; y: number; at: number } | null>(null)
  const zoomAt = (next: number, x: number, y: number) => {
    const g = zoomGesture.current
    const now = performance.now()
    if (!g || Math.abs(g.x - x) > 2 || Math.abs(g.y - y) > 2 || now - g.at > 600) {
      const r = host.current?.querySelector("svg")?.getBoundingClientRect()
      zoomGesture.current = r && r.width && r.height ? { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, x, y, at: now } : null
    } else g.at = now
    if (zoomGesture.current) anchor.current = { ...zoomGesture.current, x, y }
    setMode(Math.min(MAX, Math.max(MIN, next)))
  }
  const zoomAtRef = useRef(zoomAt)
  zoomAtRef.current = zoomAt

  // The source last handed to Pele, and the source the current natural size was measured from.
  const sourceRef = useRef(source)
  const measuredSource = useRef<string | null>(null)

  // Bumped on every Pele render: each render is a fresh <svg> that needs the zoom size applied again,
  // even when its natural size and the scale are unchanged (e.g. a re-layout after a resize).
  const [renders, setRenders] = useState(0)

  const measure = () => {
    const svg = host.current?.querySelector("svg")
    onSvg(svg ?? null)
    setRenders((n) => n + 1)
    const vb = svg?.viewBox.baseVal
    if (!vb || vb.width <= 0) return
    const edited = measuredSource.current !== null && measuredSource.current !== sourceRef.current
    measuredSource.current = sourceRef.current
    // A resize that switched Pele to a different layout: fade the new one in so it doesn't read as a flicker.
    if (relayout.current) {
      relayout.current = false
      const before = laidOutSize.current
      if (before && (before.w !== vb.width || before.h !== vb.height) && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        host.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" })
    }
    laidOutSize.current = { w: vb.width, h: vb.height }
    setNatural((prev) => {
      // Editing changed the diagram's size: keep the zoom level instead of re-fitting.
      // A re-render of the same source (e.g. once web fonts load) re-fits as usual.
      if (edited && prev && (prev.w !== vb.width || prev.h !== vb.height) && modeRef.current === "fit" && applied.current) {
        setMode(applied.current)
      }
      return prev && prev.w === vb.width && prev.h === vb.height ? prev : { w: vb.width, h: vb.height }
    })
  }

  /**
   * Pele lays some diagrams out to fit a width (e.g. a mindmap stacks vertically when
   * narrow). Give it the pane's width, so layout follows the pane and zoom only scales.
   * Without this, Pele would measure the zoomed element and re-lay out on every zoom.
   */
  const layoutWidth = () => {
    const w = scroller.current?.clientWidth ?? 0
    return Math.max(240, Math.round((w - 48) / 16) * 16)
  }
  const renderOptions = (maxWidth: number) => ({ zoom: false, responsive: false, maxWidth, onRender: measure })
  const laidOutFor = useRef(0)
  // Set while a width-driven re-layout is in flight, and the size of the layout it replaces.
  const relayout = useRef(false)
  const laidOutSize = useRef<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (!valid) return
    sourceRef.current = source
    if (!mounted.current) {
      laidOutFor.current = layoutWidth()
      mounted.current = mount(host.current!, source, renderOptions(laidOutFor.current))
    } else mounted.current.update(source)
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, valid])

  useEffect(() => () => mounted.current?.destroy(), [])

  // Re-lay out when the pane's width settles on a new value (not on zoom).
  useEffect(() => {
    if (!box.w || !valid) return
    const t = setTimeout(() => {
      const w = layoutWidth()
      if (!mounted.current || w === laidOutFor.current) return
      laidOutFor.current = w
      relayout.current = true
      mounted.current.update(sourceRef.current, renderOptions(w))
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, valid])

  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height, ow: el.offsetWidth, oh: el.offsetHeight }),
    )
    ro.observe(el)
    // ⌘/Ctrl + wheel (and trackpad pinch) zooms; needs a non-passive listener.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAtRef.current(scaleRef.current * 2 ** (-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener("wheel", onWheel)
    }
  }, [])

  const pad = 48
  // Fit shrinks big diagrams to the pane but won't blow small ones up past 200%.
  const FIT_MAX = 2
  const fit = natural && box.w ? Math.min((box.w - pad) / natural.w, (box.h - pad) / natural.h, FIT_MAX) : 1
  const scale = mode === "fit" ? fit : mode
  modeRef.current = mode
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Size the SVG explicitly so scrolling and "actual size" are exact.
  useLayoutEffect(() => {
    const svg = host.current?.querySelector("svg")
    if (!svg || !natural) return
    Object.assign(svg.style, {
      width: `${natural.w * scale}px`,
      height: `${natural.h * scale}px`,
      maxWidth: "none",
      display: "block",
    })
    applied.current = scale
    setUi({ zoomScale: scale })
    // Scroll so the anchored diagram point lands back under the cursor or fingers.
    const a = anchor.current
    const el = scroller.current
    if (a && el) {
      anchor.current = null
      const r = svg.getBoundingClientRect()
      el.scrollLeft += r.left + a.fx * r.width - a.x
      el.scrollTop += r.top + a.fy * r.height - a.y
    }
  }, [scale, natural, source, renders])

  useEffect(() => {
    if (!zoomRequest || zoomRequest.n <= handled.current) return
    handled.current = zoomRequest.n
    const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s))
    // Menu and keyboard zoom keep the centre of the pane in place.
    const r = scroller.current!.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    if (zoomRequest.action === "in") zoomAt(clamp(scale * 1.25), cx, cy)
    if (zoomRequest.action === "out") zoomAt(clamp(scale * 0.8), cx, cy)
    if (zoomRequest.action === "fit") setMode("fit")
    if (zoomRequest.action === "actual") zoomAt(1, cx, cy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequest])

  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

  // Hold Space to show the hand cursor (as in Figma), unless typing.
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.(".cm-editor, input, textarea, [contenteditable]")
    const down = (e: KeyboardEvent) => e.code === "Space" && !typing(e.target) && (e.preventDefault(), setSpaceHeld(true))
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", () => setSpaceHeld(false))
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  /**
   * Pan like a canvas: middle-button drag, Space + drag, plain left-drag or one finger.
   * Two fingers pinch-zoom around their midpoint.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<
    | { kind: "pan"; x: number; y: number; left: number; top: number }
    | { kind: "pinch"; dist: number; scale: number }
    | null
  >(null)

  const startGesture = () => {
    const el = scroller.current!
    const pts = [...pointers.current.values()]
    if (pts.length === 1) {
      gesture.current = { kind: "pan", x: pts[0].x, y: pts[0].y, left: el.scrollLeft, top: el.scrollTop }
    } else if (pts.length >= 2) {
      gesture.current = { kind: "pinch", dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, scale: scaleRef.current }
    } else gesture.current = null
    setPanning(gesture.current?.kind === "pan")
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault() // stops middle-click autoscroll and text selection
    try {
      scroller.current!.setPointerCapture(e.pointerId)
    } catch {
      // Capture can fail for synthetic or already-released pointers; dragging still works without it.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    startGesture()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const el = scroller.current!
    if (g?.kind === "pan") {
      el.scrollLeft = g.left - (e.clientX - g.x)
      el.scrollTop = g.top - (e.clientY - g.y)
    } else if (g?.kind === "pinch") {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomAt(g.scale * (dist / g.dist), (a.x + b.x) / 2, (a.y + b.y) / 2)
    }
  }

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return
    // Lifting one finger of a pinch continues as a pan with the other.
    startGesture()
  }

  // When zoomed past fit, leave room around the diagram so any edge can be panned to the middle.
  const zoomedIn = scale > fit + 0.001
  // Past fit, pad each axis by nearly a full pane (keeping 40px of diagram in view), so there is always
  // room to scroll both ways. Otherwise an axis where the diagram is still smaller than the pane gets
  // centred, and zooming drifts the point under the cursor along it.
  const gutter = (size: number) => (zoomedIn ? Math.max(24, Math.round(size - 40)) : 24)
  const margin = `${gutter(box.oh)}px ${gutter(box.ow)}px`

  return (
    <div
      ref={scroller}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      className={cn(
        "h-full w-full touch-none overflow-auto select-none",
        panning ? "cursor-grabbing" : zoomedIn || spaceHeld ? "cursor-grab" : "cursor-default",
      )}
    >
      <div className="flex min-h-full min-w-full w-max items-center justify-center" style={{ padding: margin }}>
        <div ref={host} className="pele-preview transition-opacity data-[stale=true]:opacity-30" data-stale={!valid} />
      </div>
    </div>
  )
}
