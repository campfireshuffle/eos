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
  const [box, setBox] = useState({ w: 0, h: 0 })
  const zoomRequest = useUi((s) => s.zoomRequest)
  // Ignore zoom requests made before this preview mounted (e.g. on another diagram).
  const handled = useRef(zoomRequest?.n ?? 0)

  // The last scale actually applied, and the current mode, for use inside render callbacks.
  const applied = useRef<number | null>(null)
  const modeRef = useRef<"fit" | number>("fit")

  const measure = () => {
    const svg = host.current?.querySelector("svg")
    onSvg(svg ?? null)
    const vb = svg?.viewBox.baseVal
    if (!vb || vb.width <= 0) return
    setNatural((prev) => {
      if (prev && (prev.w !== vb.width || prev.h !== vb.height) && modeRef.current === "fit" && applied.current) {
        // Editing changed the diagram's size: keep the zoom level instead of re-fitting.
        setMode(applied.current)
      }
      return prev && prev.w === vb.width && prev.h === vb.height ? prev : { w: vb.width, h: vb.height }
    })
  }

  useEffect(() => {
    if (!valid) return
    if (!mounted.current) mounted.current = mount(host.current!, source, { zoom: false, responsive: false, onRender: measure })
    else mounted.current.update(source)
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, valid])

  useEffect(() => () => mounted.current?.destroy(), [])

  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    // ⌘/Ctrl + wheel (and trackpad pinch) zooms; needs a non-passive listener.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setMode((m) => {
        const current = typeof m === "number" ? m : scaleRef.current
        return Math.min(MAX, Math.max(MIN, current * 2 ** (-e.deltaY * 0.01)))
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener("wheel", onWheel)
    }
  }, [])

  const pad = 48
  const fit = natural && box.w ? Math.min((box.w - pad) / natural.w, (box.h - pad) / natural.h, MAX) : 1
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
  }, [scale, natural, source])

  useEffect(() => {
    if (!zoomRequest || zoomRequest.n <= handled.current) return
    handled.current = zoomRequest.n
    const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s))
    if (zoomRequest.action === "in") setMode(clamp(scale * 1.25))
    if (zoomRequest.action === "out") setMode(clamp(scale * 0.8))
    if (zoomRequest.action === "fit") setMode("fit")
    if (zoomRequest.action === "actual") setMode(1)
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

  /** Pan like a canvas: middle-button drag, Space + drag, or plain left-drag. */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    const el = scroller.current!
    e.preventDefault() // stops middle-click autoscroll and text selection
    el.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    setPanning(true)
    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x)
      el.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = () => {
      setPanning(false)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
  }

  // When zoomed past fit, leave room around the diagram so any edge can be panned to the middle.
  const zoomedIn = scale > fit + 0.001
  const margin = zoomedIn ? Math.round(Math.min(box.w, box.h) * 0.4) : 24

  return (
    <div
      ref={scroller}
      onPointerDown={onPointerDown}
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
