import { Bot, Download, History, Sparkles, User } from "lucide-react"
import { useEffect, useState } from "react"

import type { Actor, HistoryEntry } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { useDiagram, useEos } from "@/lib/eos"
import { setUi, useUi } from "@/lib/ui-state"

/** Lists past versions: who made each one (you or an agent) and when. Picking one previews it. */
export function HistoryMenu({ id }: { id: string }) {
  const eos = useEos()
  const diagram = useDiagram(id)
  const preview = useUi((s) => s.preview)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (!open) return
    void eos.history(id, 100).then(setEntries)
  }, [eos, id, open, diagram?.source, diagram?.meta.title, diagram?.meta.tags.length])

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
      <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-80 gap-0 p-1.5">
        <span className="px-2 pt-1 pb-2 text-caption font-medium text-muted-foreground">Version history</span>
        <div className="flex max-h-96 min-h-0 flex-1 flex-col overflow-y-auto">
          {entries.map((e, i) => {
            const latest = i === 0
            const active = latest ? !preview : preview?.version === e.version
            return (
              <button
                key={e.version}
                type="button"
                aria-current={active || undefined}
                onClick={() => {
                  setUi({ preview: latest ? null : { id, version: e.version, at: e.at, label: actorLabel(e.actor) } })
                  setOpen(false)
                }}
                className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/40", active && "bg-accent")}
              >
                <ActorBadge actor={e.actor} />
                <span className="min-w-0 flex-1 truncate text-body">
                  {actorLabel(e.actor)}
                  {latest && <span className="ml-1.5 text-muted-foreground">· Current</span>}
                </span>
                <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{formatWhen(e.at)}</span>
              </button>
            )
          })}
          {!entries.length && <p className="px-2 py-1.5 text-caption text-muted-foreground">No history yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ActorBadge({ actor }: { actor: Actor }) {
  const agent = actor.kind === "agent"
  const Icon = agent ? Bot : actor.kind === "import" ? Download : actor.kind === "system" ? Sparkles : User
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3",
        agent && "bg-[color-mix(in_srgb,var(--eos-champagne)_22%,transparent)] text-[var(--eos-champagne)]"
      )}
    >
      <Icon />
    </span>
  )
}

export function actorLabel(actor: Actor): string {
  if (actor.kind === "agent") return "Agent"
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
