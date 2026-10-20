import { Separator } from "react-resizable-panels"
import { cn } from "@workspace/ui/lib/utils"

/**
 * A quiet resizer: an invisible 8px gutter with a small grab pill that fades in
 * on hover and brightens while dragging. Works in either orientation.
 */
export function ResizeHandle({ className }: { className?: string }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "group/handle relative flex shrink-0 items-center justify-center outline-none",
        "aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full aria-[orientation=vertical]:w-2",
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none rounded-full bg-[var(--eos-line-active)] opacity-0 transition-opacity duration-150",
          "group-aria-[orientation=vertical]/handle:h-8 group-aria-[orientation=vertical]/handle:w-1",
          "group-aria-[orientation=horizontal]/handle:h-1 group-aria-[orientation=horizontal]/handle:w-8",
          "group-data-[separator=focus]/handle:bg-ring group-data-[separator=focus]/handle:opacity-100 group-data-[separator=hover]/handle:opacity-100",
          "group-data-[separator=active]/handle:bg-[var(--eos-muted)] group-data-[separator=active]/handle:opacity-100"
        )}
      />
    </Separator>
  )
}
