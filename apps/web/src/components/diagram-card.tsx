import { Check, Star } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useLongPress } from "react-aria"

import { renderSvg, type DiagramIndexRow } from "@eos/core"

import { useEos } from "@/lib/eos"
import { diagramHref } from "@/lib/router"
import { clearSelection, getSelection, startCardDrag, toggleSelected, useSelection } from "@/lib/selection"
import { cn } from "@workspace/ui/lib/utils"

import { Pill } from "./pill"

/** Hold this long on a card (touch) to start selecting, like Photos and Files. */
const LONG_PRESS_MS = 450
const coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches

export const DiagramCard = memo(function DiagramCard({ row }: { row: DiagramIndexRow }) {
  const selected = useSelection().has(row.id)
  const longPressed = useRef(false)
  const lastPointer = useRef<string>("mouse")
  // Touch only: on desktop the card drags natively and ⌘/⇧-click selects.
  const { longPressProps } = useLongPress({
    isDisabled: !coarsePointer,
    threshold: LONG_PRESS_MS,
    onLongPress: (e) => {
      if (e.pointerType !== "touch") return
      longPressed.current = true
      toggleSelected(row.id)
      navigator.vibrate?.(10)
    },
  })

  return (
    <a
      href={diagramHref(row.id)}
      data-card-id={row.id}
      // On touch, a long press selects instead of starting a native drag.
      draggable={!coarsePointer}
      onDragStart={(e) => startCardDrag(e, row.id)}
      {...longPressProps}
      // Runs before React Aria's handler (capture), so a long press always starts fresh.
      onPointerDownCapture={(e) => {
        lastPointer.current = e.pointerType
        longPressed.current = false
      }}
      onContextMenu={(e) => lastPointer.current === "touch" && e.preventDefault()}
      onClick={(e) => {
        if (longPressed.current) {
          // The long press already selected the card; don't also open it.
          e.preventDefault()
          longPressed.current = false
          return
        }
        if (e.metaKey || e.ctrlKey || e.shiftKey || (lastPointer.current === "touch" && getSelection().size > 0)) {
          // ⌘/⇧-click, or a tap while selecting on touch, adds or removes the card.
          e.preventDefault()
          toggleSelected(row.id)
        } else clearSelection()
      }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors select-none [-webkit-touch-callout:none] hover:border-[var(--eos-line-active)]",
        selected && "border-[var(--eos-champagne)] ring-1 ring-[var(--eos-champagne)] hover:border-[var(--eos-champagne)]"
      )}
    >
      {selected && (
        <span className="absolute top-2.5 right-2.5 z-10 flex size-6 items-center justify-center rounded-full bg-[var(--eos-champagne)] text-[var(--eos-ink)] shadow-sm">
          <Check className="size-3.5" strokeWidth={3} />
          <span className="sr-only">Selected</span>
        </span>
      )}
      <Thumbnail id={row.id} source={row.sourceText} updatedAt={row.updatedAt} />
      <div className="flex flex-col gap-1.5 border-t border-border px-3.5 pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-body font-medium">{row.title}</span>
          {row.starred === 1 && <Star className="size-3.5 fill-[var(--eos-champagne)] text-[var(--eos-champagne)]" />}
        </div>
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
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

/**
 * Renders the diagram live with Pele while the card is within about a screen of view, and
 * drops it again further out, so scrolling a long library doesn't keep every SVG in the page.
 */
function Thumbnail({ id, source, updatedAt }: { id: string; source: string | undefined; updatedAt: number }) {
  const eos = useEos()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // On desktop the library scrolls inside its pane, which a rootMargin doesn't reach past; scrollMargin does.
    const io = new IntersectionObserver((entries) => setVisible(entries.at(-1)!.isIntersecting), {
      rootMargin: "100% 0px",
      scrollMargin: "100% 0px",
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Rows written before the index kept the full source have to read it from the diagram.
  useEffect(() => {
    if (!visible || source !== undefined) return
    let alive = true
    eos.getSource(id).then(
      (text) => alive && setLoaded(text),
      () => alive && setLoaded("")
    )
    return () => {
      alive = false
    }
  }, [eos, id, source, updatedAt, visible])

  const text = source ?? loaded
  const svg = useMemo(() => {
    if (!visible || text === null) return null
    try {
      return renderSvg(text, `t-${id.slice(0, 8)}-`)
    } catch {
      return ""
    }
  }, [id, text, visible])

  return (
    <div
      ref={ref}
      aria-hidden={!!svg}
      // The SVG is sized to fit in app.css.
      className="pele-thumb relative flex aspect-[268/150] items-center justify-center overflow-hidden bg-background"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg === "" ? <span className="text-caption text-[var(--eos-faint)]">Can’t render</span> : null}
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
