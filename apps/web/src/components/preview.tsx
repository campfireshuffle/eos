import { mount, type Mounted } from "pele"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { setUi, useUi } from "@/lib/ui-state"
import { clamp, fit, FIT_MAX, fitScale, holdCentre, panBy, zoomAt, type Size, type View } from "@/lib/viewport"

/**
 * Live Pele render with our own pan and zoom. The pane never scrolls: the diagram sits on a stage that one
 * transform moves and scales. "Fit" scales it to the pane; any other zoom is relative to the SVG's natural size
 * (1 = 100%). Always draws `source`. While the text has errors the editor passes the last good diagram,
 * and `stale` dims it.
 */
export function Preview({ source, stale, onSvg }: { source: string; stale: boolean; onSvg: (el: SVGSVGElement | null) => void }) {
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<Mounted | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [pane, setPane] = useState<Size>({ w: 0, h: 0 })
  const [fitting, setFitting] = useState(true)
  // The most a fitted preview may zoom to. Each edit caps it at the current fit, so an edit can shrink the
  // diagram to fit but never zooms it back in (typing would otherwise bounce the zoom as nodes come and go).
  // Choosing fit again, or a new pane size, lifts it.
  const [fitCap, setFitCap] = useState(FIT_MAX)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  // The zoom on screen, for the readout and the cursor.
  const [scale, setScale] = useState(1)
  const zoomRequest = useUi((s) => s.zoomRequest)
  // Ignore zoom requests made before this preview mounted (e.g. on another diagram).
  const handled = useRef(zoomRequest?.n ?? 0)

  // While the stage moves it gets a layer of its own; once it settles that goes, so the browser redraws the text sharp.
  const settle = useRef(0)
  /** Puts the diagram at `v`, kept within reach. */
  const show = (v: View) => {
    const el = stage.current!
    view.current = natural ? clamp(v, pane, natural) : v
    const { x, y, k } = view.current
    el.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    el.style.willChange = "transform"
    clearTimeout(settle.current)
    settle.current = window.setTimeout(() => (el.style.willChange = ""), 200)
    setScale(k)
  }
  /** Moves the diagram as the person asked, so it stops following the fit. */
  const move = (v: View) => {
    setFitting(false)
    show(v)
  }
  // For the listeners added once, below.
  const moveRef = useRef(move)
  moveRef.current = move
  /** A point on screen, in the pane's coordinates. */
  const inPane = (x: number, y: number) => {
    const r = frame.current!.getBoundingClientRect()
    return [x - r.left, y - r.top] as const
  }

  // A fitted diagram follows the pane and its own size. A zoomed one stays put: the stage's transform already
  // keeps the diagram point at the pane's centre there as Pele draws a new layout of a different size.
  useLayoutEffect(() => {
    if (natural && pane.w) show(fitting ? fit(pane, natural, fitCap) : view.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitting, natural, pane, fitCap])
  useLayoutEffect(() => setUi({ zoomScale: scale }), [scale])

  // The source last handed to Pele.
  const sourceRef = useRef(source)

  const measure = () => {
    const svg = host.current?.querySelector("svg")
    onSvg(svg ?? null)
    const vb = svg?.viewBox.baseVal
    if (!svg || !vb || vb.width <= 0) return
    // Drawn at its natural size; the stage does the zooming.
    Object.assign(svg.style, { width: `${vb.width}px`, height: `${vb.height}px`, maxWidth: "none", display: "block" })
    // A resize that switched Pele to a different layout: fade the new one in so it doesn't read as a flicker.
    if (relayout.current) {
      relayout.current = false
      const before = laidOutSize.current
      if (before && (before.w !== vb.width || before.h !== vb.height) && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        host.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" })
    }
    laidOutSize.current = { w: vb.width, h: vb.height }
    setNatural((prev) => (prev && prev.w === vb.width && prev.h === vb.height ? prev : { w: vb.width, h: vb.height }))
  }

  /**
   * Pele lays some diagrams out to fit a width (e.g. a mindmap stacks vertically when
   * narrow). Give it the pane's width, so layout follows the pane and zoom only scales.
   */
  const layoutWidth = () => Math.max(240, Math.round(((frame.current?.clientWidth ?? 0) - 48) / 16) * 16)
  const renderOptions = (maxWidth: number) => ({ zoom: false, responsive: false, maxWidth, onRender: measure })
  const laidOutFor = useRef(0)
  // Set while a width-driven re-layout is in flight, and the size of the layout it replaces.
  const relayout = useRef(false)
  const laidOutSize = useRef<{ w: number; h: number } | null>(null)

  useEffect(() => {
    sourceRef.current = source
    if (!mounted.current) {
      laidOutFor.current = layoutWidth()
      mounted.current = mount(host.current!, source, renderOptions(laidOutFor.current))
    } else {
      if (fitting) setFitCap(view.current.k)
      mounted.current.update(source)
    }
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  useEffect(() => () => mounted.current?.destroy(), [])

  // Re-lay out when the pane's width settles on a new value (not on zoom).
  useEffect(() => {
    if (!pane.w) return
    const t = setTimeout(() => {
      const w = layoutWidth()
      if (!mounted.current || w === laidOutFor.current) return
      laidOutFor.current = w
      relayout.current = true
      mounted.current.update(sourceRef.current, renderOptions(w))
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.w])

  useEffect(() => {
    const el = frame.current!
    let from: Size | null = null
    const ro = new ResizeObserver(([e]) => {
      const to = { w: e.contentRect.width, h: e.contentRect.height }
      // A zoomed diagram keeps the point at the pane's centre there. A new size may leave room to zoom a fitted one back in.
      if (from) view.current = holdCentre(view.current, from, to)
      from = to
      setPane(to)
      setFitCap(FIT_MAX)
    })
    ro.observe(el)
    // ⌘/Ctrl + wheel, and a trackpad pinch (sent as one), zooms at the pointer; a wheel or two-finger swipe pans.
    // Needs a non-passive listener, which also stops a sideways swipe from going back a page.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Firefox counts a mouse wheel in lines, and some wheels in pages.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const v = view.current
      moveRef.current(
        e.ctrlKey || e.metaKey
          ? zoomAt(v, v.k * 2 ** (-e.deltaY * unit * 0.01), ...inPane(e.clientX, e.clientY))
          : panBy(v, -e.deltaX * unit, -e.deltaY * unit)
      )
    }
    const off = new AbortController()
    el.addEventListener("wheel", onWheel, { passive: false, signal: off.signal })
    // Safari's own pinch events would zoom the whole page as well.
    for (const type of ["gesturestart", "gesturechange"]) el.addEventListener(type, (e) => e.preventDefault(), { signal: off.signal })
    return () => (ro.disconnect(), off.abort())
  }, [])

  useEffect(() => {
    if (!zoomRequest || zoomRequest.n <= handled.current) return
    handled.current = zoomRequest.n
    // Menu and keyboard zoom keep the centre of the pane in place.
    const zoom = (k: number) => move(zoomAt(view.current, k, pane.w / 2, pane.h / 2))
    if (zoomRequest.action === "in") zoom(view.current.k * 1.25)
    if (zoomRequest.action === "out") zoom(view.current.k * 0.8)
    if (zoomRequest.action === "actual") zoom(1)
    if (zoomRequest.action === "fit") {
      setFitCap(FIT_MAX)
      setFitting(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequest])

  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

  // Hold Space to show the hand cursor (as in Figma), unless something focused uses Space (typing, a button).
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === "Space" && e.target === document.body && (e.preventDefault(), setSpaceHeld(true))
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false)
    const off = new AbortController()
    window.addEventListener("keydown", down, { signal: off.signal })
    window.addEventListener("keyup", up, { signal: off.signal })
    window.addEventListener("blur", () => setSpaceHeld(false), { signal: off.signal })
    return () => off.abort()
  }, [])

  /**
   * Pan like a canvas: middle-button drag, Space + drag, plain left-drag or one finger.
   * Two fingers pinch-zoom, and the diagram point between them follows their midpoint.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  // Where the gesture started: the view, and the pointers' midpoint and spread.
  const gesture = useRef<{ view: View; x: number; y: number; spread: number } | null>(null)
  const touch = () => {
    const [a, b = a] = pointers.current.values()
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) }
  }

  const startGesture = () => {
    gesture.current = pointers.current.size ? { view: view.current, ...touch() } : null
    setPanning(pointers.current.size === 1)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault() // stops middle-click autoscroll and text selection
    // …and focus moving, so blur whatever had it: the preview's shortcuts and Space-to-pan listen on the page.
    // Safari still types into an editor that keeps a selection, so clear that too.
    ;(document.activeElement as HTMLElement | null)?.blur()
    getSelection()?.removeAllRanges()
    try {
      frame.current!.setPointerCapture(e.pointerId)
    } catch {
      // Capture can fail for synthetic or already-released pointers; dragging still works without it.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    startGesture()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const now = touch()
    const k = pointers.current.size > 1 ? (g.view.k * now.spread) / (g.spread || 1) : g.view.k
    move(panBy(zoomAt(g.view, k, ...inPane(g.x, g.y)), now.x - g.x, now.y - g.y))
  }

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return
    // Lifting one finger of a pinch continues as a pan with the other.
    startGesture()
  }

  const zoomedIn = !!natural && scale > fitScale(pane, natural, fitCap) + 0.001

  return (
    <div
      ref={frame}
      data-preview-frame
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      className={cn(
        "relative h-full w-full touch-none overflow-clip overscroll-contain select-none",
        panning ? "cursor-grabbing" : zoomedIn || spaceHeld ? "cursor-grab" : "cursor-default"
      )}
    >
      <div ref={stage} className="absolute top-0 left-0 w-max origin-top-left">
        <div ref={host} className="pele-preview transition-opacity data-[stale=true]:opacity-30" data-stale={stale} />
      </div>
    </div>
  )
}
