import { Bot, Download, History, Sparkles, User } from "lucide-react"
import { useEffect, useState } from "react"

import type { Actor, HistoryEntry } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { useDiagram, useEos } from "@/lib/eos"
import { setUi, useUi } from "@/lib/ui-state"

type Filter = "all" | "user" | "agent"

/**
 * Lists past versions: who (you or an agent), what changed and when. Agent edits
 * are kept apart from yours, can be filtered, and picking any entry previews it.
 */
export function HistoryMenu({ id }: { id: string }) {
  const eos = useEos()
  const diagram = useDiagram(id)
  const preview = useUi((s) => s.preview)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState<Filter>("all")

  useEffect(() => {
    if (!open) return
    void eos.history(id, 100).then(setEntries)
  }, [eos, id, open, diagram?.source, diagram?.meta.title, diagram?.meta.tags.length])

  const hasAgent = entries.some((e) => e.actor.kind === "agent")
  const shown = entries
    .map((e, i) => ({ e, latest: i === 0 }))
    .filter(({ e }) => filter === "all" || (filter === "agent" ? e.actor.kind === "agent" : e.actor.kind !== "agent"))

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
      <PopoverContent align="end" className="w-80 gap-0 p-1.5">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2">
          <span className="flex-1 text-caption font-medium text-muted-foreground">Version history</span>
          {hasAgent && (
            <div role="radiogroup" aria-label="Show" className="flex rounded-md bg-muted p-0.5 text-caption">
              {(["all", "user", "agent"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded px-2 py-0.5 text-muted-foreground",
                    filter === f && "bg-background font-medium text-foreground shadow-xs",
                  )}
                >
                  {f === "all" ? "All" : f === "user" ? "You" : "Agent"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex max-h-96 flex-col overflow-y-auto">
          {shown.map(({ e, latest }) => {
            const active = latest ? !preview : preview?.version === e.version
            const detail = describe(e)
            return (
              <button
                key={e.version}
                type="button"
                onClick={() => {
                  setUi({ preview: latest ? null : { id, version: e.version, at: e.at, label: actorLabel(e.actor) } })
                  setOpen(false)
                }}
                className={cn(
                  "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/40",
                  active && "bg-accent",
                )}
              >
                <ActorBadge actor={e.actor} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body">
                    {actorLabel(e.actor)}
                    {latest && <span className="ml-1.5 text-muted-foreground">· Current</span>}
                  </span>
                  {detail && <span className="line-clamp-2 text-caption text-muted-foreground">{detail}</span>}
                </span>
                <span className="shrink-0 pt-px text-caption text-muted-foreground tabular-nums">{formatWhen(e.at)}</span>
              </button>
            )
          })}
          {!shown.length && (
            <p className="px-2 py-1.5 text-caption text-muted-foreground">{entries.length ? "Nothing here yet." : "No history yet."}</p>
          )}
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
        "mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3",
        agent && "bg-[color-mix(in_srgb,var(--eos-champagne)_22%,transparent)] text-[var(--eos-champagne)]",
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

/** One line on what an agent's edits did, from the changes recorded with them. */
function describe(e: HistoryEntry): string | null {
  if (e.actor.kind !== "agent") return null
  const changes = e.changes?.length ? e.changes : [e.actor.tool.replace(/_/g, " ")]
  if (changes.includes("created")) return "Created this diagram"
  const parts: string[] = []
  if (changes.includes("undo")) parts.push("undid its last edit")
  if (changes.includes("redo")) parts.push("redid an edit")
  if (changes.includes("restored version")) parts.push("restored an earlier version")
  const fields = changes.filter((c) => ["source", "title", "tags", "starred"].includes(c))
  const names: Record<string, string> = { source: "the diagram", title: "the title", tags: "tags", starred: "the star" }
  if (fields.length) parts.push(`changed ${list(fields.map((f) => names[f]))}`)
  const other = changes.filter((c) => !["undo", "redo", "restored version", "source", "title", "tags", "starred"].includes(c))
  parts.push(...other)
  const text = list(parts)
  return text ? text[0].toUpperCase() + text.slice(1) : null
}

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

export function formatWhen(ms: number): string {
  const d = new Date(ms)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
