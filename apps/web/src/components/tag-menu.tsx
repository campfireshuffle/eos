import { Check, Hash, Minus, Plus, Tags } from "lucide-react"
import { useMemo, useState } from "react"

import { normalizeTag, type TagRecord } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useEos, useLibrary, useTags } from "@/lib/eos"

type State = "all" | "some" | "none"

/**
 * Apply or remove tags across the selected diagrams. Each tag shows whether all,
 * some or none of the selection has it. Clicking a tag that every selected
 * diagram has removes it from all of them; otherwise it's added to all.
 */
export function TagMenu({ ids }: { ids: string[] }) {
  const eos = useEos()
  const tags = useTags()
  const rows = useLibrary({})
  const [query, setQuery] = useState("")

  const tagsById = useMemo(() => new Map((rows ?? []).map((r) => [r.id, new Set(r.tags)])), [rows])
  const all = useMemo(() => flatten(tags ?? []), [tags])
  const stateOf = (path: string): State => {
    const n = ids.filter((id) => tagsById.get(id)?.has(path)).length
    return n === 0 ? "none" : n === ids.length ? "all" : "some"
  }

  const q = query.trim().toLowerCase()
  const matches = all.filter((t) => !q || t.path.includes(q))
  const newTag = normalizeTag(query)
  const canCreate = !!newTag && !all.some((t) => t.path === newTag)

  const toggle = (path: string) => {
    if (stateOf(path) === "all") ids.forEach((id) => void eos.removeTags(id, [path]))
    else ids.forEach((id) => void eos.addTags(id, [path]))
  }
  const create = () => {
    if (!newTag) return
    ids.forEach((id) => void eos.addTags(id, [newTag]))
    setQuery("")
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full">
          <Tags /> Tags
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-64 gap-1 p-1.5">
        <Input
          autoFocus
          placeholder="Find or create a tag"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            if (canCreate) create()
            else if (matches[0]) toggle(matches[0].path)
          }}
          className="mb-1"
        />
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {matches.map((t) => {
            const state = stateOf(t.path)
            return (
              <button
                key={t.path}
                type="button"
                role="menuitemcheckbox"
                aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                onClick={() => toggle(t.path)}
                className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-accent"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--eos-line-active)]",
                    state !== "none" && "border-transparent bg-primary text-primary-foreground",
                  )}
                >
                  {state === "all" && <Check className="size-3" />}
                  {state === "some" && <Minus className="size-3" />}
                </span>
                <span className="flex size-4 items-center justify-center text-muted-foreground">
                  {t.emoji ? <span className="text-[13px] leading-none">{t.emoji}</span> : <Hash className="size-3.5" />}
                </span>
                <span className="flex-1 truncate">{t.path}</span>
              </button>
            )
          })}
          {canCreate && (
            <button
              type="button"
              onClick={create}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" /> Create “{newTag}”
            </button>
          )}
          {!matches.length && !canCreate && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function flatten(tags: TagRecord[]): TagRecord[] {
  return tags.flatMap((t) => [t, ...flatten(t.children)])
}
