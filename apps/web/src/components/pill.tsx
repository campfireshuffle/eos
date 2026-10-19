import { X } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

/** The one pill style for tags, filters and states (e.g. "Starred"). */
export function Pill({
  children,
  icon,
  removeHref,
  removeLabel,
  size = "md",
}: {
  children: ReactNode
  icon?: ReactNode
  removeHref?: string
  removeLabel?: string
  size?: "sm" | "md"
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border bg-accent text-foreground",
        size === "md" ? "h-6 px-2.5 text-xs" : "h-5 px-2 text-[11px]",
        removeHref && (size === "md" ? "pr-1.5" : "pr-1"),
      )}
    >
      {icon && <span className="shrink-0 leading-none">{icon}</span>}
      <span className="truncate">{children}</span>
      {removeHref && (
        <a href={removeHref} aria-label={removeLabel} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-3" />
        </a>
      )}
    </span>
  )
}
