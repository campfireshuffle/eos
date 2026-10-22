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
  const [open, setOpen] = useState(false)
  // Tags this menu unchecked since it opened, with their row's place, so removing a tag's last use leaves its row,
  // and focus, where they were. Checking it again re-adds the tag.
  const [unchecked, setUnchecked] = useState(new Map<string, [number, TagRecord]>())

  const tagsById = useMemo(() => new Map((rows ?? []).map((r) => [r.id, new Set(r.tags)])), [rows])
  const all = useMemo(() => flatten(tags ?? []), [tags])
  const shown = useMemo(() => {
    const out = [...all]
    for (const [i, t] of [...unchecked.values()].sort(([a], [b]) => a - b)) if (!all.some((a) => a.path === t.path)) out.splice(i, 0, t)
    return out
  }, [all, unchecked])
  const stateOf = (path: string): State => {
    const n = ids.filter((id) => tagsById.get(id)?.has(path)).length
    return n === 0 ? "none" : n === ids.length ? "all" : "some"
  }

  const newTag = normalizeTag(query)
  const q = newTag ?? ""
  const matches = shown.filter((t) => !q || t.path.includes(q))
  const canCreate = !!newTag && !all.some((t) => t.path === newTag)

  const toggle = (path: string) => {
    if (stateOf(path) === "all") {
      const i = shown.findIndex((t) => t.path === path)
      setUnchecked((u) => new Map(u).set(path, [i, shown[i]!]))
      void eos.removeTags(ids, [path])
    } else void eos.addTags(ids, [path])
  }
  const create = () => {
    if (!newTag) return
    void eos.addTags(ids, [newTag])
    setQuery("")
  }

  // Closes once nothing's selected (say the change moved the cards out of view): its checkboxes would act on nothing.
  // Resetting `open`, not just hiding the menu, keeps it from reopening by itself with the next selection.
  if (open && !ids.length) setOpen(false)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setUnchecked(new Map())
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full">
          <Tags /> <span className="max-sm:sr-only">Tags</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={10}
        data-selection-menu
        // Focusing the search on a touch screen raises the keyboard over the list; there, it waits for a tap.
        onOpenAutoFocus={(e) => matchMedia("(pointer: coarse)").matches && e.preventDefault()}
        // Emptying the selection already moved focus off the bar, so not back to its now inert Tags button.
        onCloseAutoFocus={(e) => !ids.length && e.preventDefault()}
        className="max-h-[var(--radix-popover-content-available-height)] w-64 gap-1 p-1.5"
      >
        <Input
          placeholder="Find or create a tag"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Not the Enter that confirms an IME candidate (see the title field).
            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return
            e.preventDefault()
            if (canCreate) create()
            else {
              // The tag typed (as it would be saved), else the first match.
              const t = all.find((t) => t.path === newTag) ?? matches[0]
              if (t) toggle(t.path)
            }
          }}
          className="mb-1"
        />
        <div className="flex max-h-64 min-h-0 flex-col overflow-y-auto">
          {matches.map((t) => {
            const state = stateOf(t.path)
            return (
              <button
                key={t.path}
                type="button"
                role="checkbox"
                aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                onClick={() => toggle(t.path)}
                className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-body hover:bg-accent"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--eos-line-active)]",
                    state !== "none" && "border-transparent bg-primary text-primary-foreground"
                  )}
                >
                  {state === "all" && <Check className="size-3" />}
                  {state === "some" && <Minus className="size-3" />}
                </span>
                <span className="flex size-4 items-center justify-center text-muted-foreground">
                  {t.emoji ? <span className="text-body leading-none">{t.emoji}</span> : <Hash className="size-3.5" />}
                </span>
                <span className="flex-1 truncate">{t.path}</span>
              </button>
            )
          })}
          {canCreate && (
            <button
              type="button"
              onClick={create}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-body text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" /> Create “{newTag}”
            </button>
          )}
          {!matches.length && !canCreate && <p className="px-2 py-1.5 text-caption text-muted-foreground">No tags yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function flatten(tags: TagRecord[]): TagRecord[] {
  return tags.flatMap((t) => [t, ...flatten(t.children)])
}
