import { Star, Trash2, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useEos } from "@/lib/eos"
import { clearSelection, useSelection } from "@/lib/selection"
import { askConfirm } from "@/lib/ui-state"

/** Floating, glassy action bar for selected cards (à la Linear / Figma). */
export function SelectionBar() {
  const eos = useEos()
  const selection = useSelection()
  const count = selection.size
  const ids = [...selection]

  return (
    <div
      aria-hidden={!count}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center transition-all duration-200",
        count ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      <div
        role="toolbar"
        aria-label="Selection"
        className={cn(
          "flex items-center gap-1 rounded-full border border-white/10 py-1.5 pr-1.5 pl-4 text-[13px]",
          "bg-[color-mix(in_srgb,var(--eos-raised)_62%,transparent)] backdrop-blur-xl backdrop-saturate-150",
          "shadow-[0_12px_40px_-8px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.06)]",
          count && "pointer-events-auto",
        )}
      >
        <span className="pr-2 tabular-nums">{count} selected</span>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => ids.forEach((id) => void eos.setStarred(id, true))}
        >
          <Star /> Star
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-destructive hover:text-destructive"
          onClick={async () => {
            if (!(await askConfirm(`Delete ${count === 1 ? "this diagram" : `${count} diagrams`}?`))) return
            await Promise.all(ids.map((id) => eos.deleteDiagram(id)))
            clearSelection()
          }}
        >
          <Trash2 /> Delete
        </Button>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" aria-label="Clear selection" onClick={clearSelection}>
          <X />
        </Button>
      </div>
    </div>
  )
}
