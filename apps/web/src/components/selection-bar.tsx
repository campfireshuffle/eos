import { RotateCcw, Star, Trash2, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useEos } from "@/lib/eos"
import { clearSelection, useSelection } from "@/lib/selection"
import { askConfirm } from "@/lib/ui-state"

import { TagMenu } from "./tag-menu"

/** Floating, glassy action bar for selected cards (à la Linear / Figma). */
export function SelectionBar({ deleted = false }: { deleted?: boolean }) {
  const eos = useEos()
  const selection = useSelection()
  const count = selection.size
  const ids = [...selection]

  return (
    <div
      aria-hidden={!count}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-6 z-20 max-md:fixed max-md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] flex justify-center transition-all duration-200",
        count ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      <div
        role="toolbar"
        aria-label="Selection"
        className={cn(
          "flex items-center gap-1 rounded-full border border-[var(--eos-line-hover)] py-1.5 pr-1.5 pl-4 text-body",
          "bg-[color-mix(in_srgb,var(--eos-raised)_62%,transparent)] backdrop-blur-xl backdrop-saturate-150",
          "shadow-[0_12px_40px_-8px_rgb(0_0_0/0.35),inset_0_1px_0_color-mix(in_srgb,var(--eos-body)_6%,transparent)]",
          count && "pointer-events-auto",
        )}
      >
        <span className="pr-2 tabular-nums">{count} selected</span>
        <div className="mx-1 h-4 w-px bg-[var(--eos-line-hover)]" />
        {deleted ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={async () => {
                await Promise.all(ids.map((id) => eos.restoreDiagram(id)))
                clearSelection()
              }}
            >
              <RotateCcw /> Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-destructive hover:text-destructive"
              onClick={async () => {
                const what = count === 1 ? "this diagram" : `${count} diagrams`
                if (!(await askConfirm(`Permanently delete ${what}? This can’t be undone.`, "Delete forever"))) return
                await Promise.all(ids.map((id) => eos.purge(id)))
                clearSelection()
              }}
            >
              <Trash2 /> Delete forever
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => ids.forEach((id) => void eos.setStarred(id, true))}
            >
              <Star /> Star
            </Button>
            <TagMenu ids={ids} />
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-destructive hover:text-destructive"
              onClick={async () => {
                if (!(await askConfirm(`Move ${count === 1 ? "this diagram" : `${count} diagrams`} to Deleted?`))) return
                await Promise.all(ids.map((id) => eos.deleteDiagram(id)))
                clearSelection()
              }}
            >
              <Trash2 /> Delete
            </Button>
          </>
        )}
        <div className="mx-1 h-4 w-px bg-[var(--eos-line-hover)]" />
        <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" aria-label="Clear selection" onClick={clearSelection}>
          <X />
        </Button>
      </div>
    </div>
  )
}
