import { ArrowLeft, ArrowRight } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { useHistoryNav } from "@/lib/history"

/** Back/forward inside Eos. Hidden until there is somewhere to go. */
export function HistoryNav() {
  const { canGoBack, canGoForward } = useHistoryNav()
  if (!canGoBack && !canGoForward) return null
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" aria-label="Back" disabled={!canGoBack} onClick={() => history.back()} className="text-muted-foreground">
        <ArrowLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Forward" disabled={!canGoForward} onClick={() => history.forward()} className="text-muted-foreground">
        <ArrowRight />
      </Button>
    </div>
  )
}
