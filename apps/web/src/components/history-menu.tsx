import { Bot, Download, History, Sparkles, User } from "lucide-react"
import { useEffect, useState } from "react"

import type { Actor, HistoryEntry } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { useDiagram, useEos } from "@/lib/eos"
import { setUi, useUi } from "@/lib/ui-state"

/** Lists past versions (who, when). Picking one previews it read-only in the editor. */
export function HistoryMenu({ id }: { id: string }) {
  const eos = useEos()
  const diagram = useDiagram(id)
  const preview = useUi((s) => s.preview)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (!open) return
    void eos.history(id, 50).then(setEntries)
  }, [eos, id, open, diagram?.source])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Version history" className="text-muted-foreground">
              <History />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Version history</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 gap-0 p-1.5">
        <div className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">Version history</div>
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {entries.map((e, i) => {
            const latest = i === 0
            const active = latest ? !preview : preview?.version === e.version
            return (
              <button
                key={e.version}
                type="button"
                onClick={() => {
                  setUi({ preview: latest ? null : { id, version: e.version, at: e.at, label: actorLabel(e.actor) } })
                  setOpen(false)
                }}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent/40",
                  active && "bg-accent",
                )}
              >
                <ActorIcon actor={e.actor} />
                <span className="flex-1 truncate">
                  {actorLabel(e.actor)}
                  {latest && <span className="ml-1.5 text-muted-foreground">· Current</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatWhen(e.at)}</span>
              </button>
            )
          })}
          {!entries.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No history yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ActorIcon({ actor }: { actor: Actor }) {
  const cls = "size-4 shrink-0 text-muted-foreground"
  if (actor.kind === "agent") return <Bot className={cls} />
  if (actor.kind === "import") return <Download className={cls} />
  if (actor.kind === "system") return <Sparkles className={cls} />
  return <User className={cls} />
}

export function actorLabel(actor: Actor): string {
  if (actor.kind === "agent") return `Agent · ${actor.tool.replace(/_/g, " ")}`
  if (actor.kind === "import") return actor.source === "share-link" ? "Imported from link" : "Imported from backup"
  if (actor.kind === "system") return actor.reason === "seed" ? "Created" : actor.reason
  return "You"
}

export function formatWhen(ms: number): string {
  const d = new Date(ms)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
