import { mount, type Mounted } from "pele"
import { useEffect, useRef } from "react"

import { getUi, setUi, useUi } from "@/lib/ui-state"

/** Live Pele render. Keeps the last good diagram on screen while the source has errors. */
export function Preview({ source, valid, onSvg }: { source: string; valid: boolean; onSvg: (el: SVGSVGElement | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const mounted = useRef<Mounted | null>(null)
  const zoomRequest = useUi((s) => s.zoomRequest)

  useEffect(() => {
    if (!valid) return
    if (!mounted.current) {
      mounted.current = mount(host.current!, source, {
        zoom: { always: true, controls: false, maxScale: 8 },
        onRender: () => {
          onSvg(host.current?.querySelector("svg") ?? null)
          setUi({ zoomScale: mounted.current?.zoom?.scale ?? 1 })
        },
      })
    } else {
      mounted.current.update(source)
    }
    onSvg(host.current?.querySelector("svg") ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, valid])

  useEffect(() => () => mounted.current?.destroy(), [])

  useEffect(() => {
    const zoom = mounted.current?.zoom
    if (!zoomRequest || !zoom) return
    if (zoomRequest.action === "in") zoom.zoomBy(1.25)
    if (zoomRequest.action === "out") zoom.zoomBy(0.8)
    if (zoomRequest.action === "fit") zoom.reset()
    if (zoomRequest.action === "actual") zoom.zoomTo(1)
    setUi({ zoomScale: zoom.scale })
  }, [zoomRequest])

  return (
    <div
      ref={host}
      className="pele-preview h-full w-full transition-opacity data-[stale=true]:opacity-30"
      data-stale={!valid}
      onWheel={() => requestAnimationFrame(() => setUi({ zoomScale: mounted.current?.zoom?.scale ?? getUi().zoomScale }))}
    />
  )
}
