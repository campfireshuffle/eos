import { Star } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"

import { renderSvg, type DiagramIndexRow } from "@eos/core"

import { useEos } from "@/lib/eos"
import { diagramHref } from "@/lib/router"

import { Pill } from "./pill"

export const DiagramCard = memo(function DiagramCard({ row }: { row: DiagramIndexRow }) {
  return (
    <a
      href={diagramHref(row.id)}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-[var(--eos-line-active)]"
    >
      <Thumbnail id={row.id} updatedAt={row.updatedAt} />
      <div className="flex flex-col gap-1.5 border-t border-border px-3.5 pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-sm font-medium">{row.title}</span>
          {row.starred === 1 && <Star className="size-3.5 fill-[var(--eos-champagne)] text-[var(--eos-champagne)]" />}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {row.tags.map((t) => (
              <Pill key={t} size="sm">
                {t}
              </Pill>
            ))}
          </span>
          <span className="shrink-0">{relativeTime(row.updatedAt)}</span>
        </div>
      </div>
    </a>
  )
})

/** Renders the diagram live with Pele once the card scrolls into view. */
function Thumbnail({ id, updatedAt }: { id: string; updatedAt: number }) {
  const eos = useEos()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setVisible(true), io.disconnect()), { rootMargin: "200px" })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    eos.getSource(id).then((source) => {
      if (!alive) return
      try {
        setSvg(renderSvg(source, `t-${id.slice(0, 8)}-`))
      } catch {
        setSvg("")
      }
    })
    return () => {
      alive = false
    }
  }, [eos, id, updatedAt, visible])

  return (
    <div
      ref={ref}
      className="pele-thumb flex aspect-[268/150] items-center justify-center overflow-hidden bg-background p-4 [&_svg]:max-h-full [&_svg]:max-w-full"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg === "" ? <span className="text-xs text-[var(--eos-faint)]">Can’t render</span> : null}
    </div>
  )
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.round(diff / 60000)
  if (min < 1) return "Just now"
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
