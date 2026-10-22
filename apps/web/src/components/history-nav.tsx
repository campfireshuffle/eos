import { ArrowLeft, ArrowRight } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { useHistoryNav } from "@/lib/history"

/**
 * Back/forward inside Eos. Hidden until there is somewhere to go. A button with nowhere to go is
 * aria-disabled, not disabled, so pressing it to the end of history keeps its focus.
 */
export function HistoryNav() {
  const { canGoBack, canGoForward } = useHistoryNav()
  if (!canGoBack && !canGoForward) return null
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Back"
        aria-disabled={!canGoBack}
        onClick={() => canGoBack && navigation.back()}
        className="text-muted-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Forward"
        aria-disabled={!canGoForward}
        onClick={() => canGoForward && navigation.forward()}
        className="text-muted-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <ArrowRight />
      </Button>
    </div>
  )
}
