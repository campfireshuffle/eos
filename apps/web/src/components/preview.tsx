import { mount, type Mounted } from "pele"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

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

  const measure = () => {
    const svg = host.current?.querySelector("svg")
    onSvg(svg ?? null)
    const vb = svg?.viewBox.baseVal
    if (vb && vb.width > 0) setNatural({ w: vb.width, h: vb.height })
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

  return (
    <div
      ref={scroller}
      className="h-full w-full overflow-auto"
    >
      <div className="flex min-h-full min-w-full w-max items-center justify-center p-6">
        <div ref={host} className="pele-preview transition-opacity data-[stale=true]:opacity-30" data-stale={!valid} />
      </div>
    </div>
  )
}
