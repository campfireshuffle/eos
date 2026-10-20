import type { ComponentProps, ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { HistoryNav } from "./history-nav"
import { SidebarToggle } from "./sidebar-toggle"

/**
 * A page's header, on the shell's grey above its panels: back/forward and the title on the
 * left, the page's own actions on the right. A string title is the page's heading; anything
 * else (the editor's title field) brings its own element and inherits the type.
 */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-1.5 pr-2 pl-1.5">
      <SidebarToggle />
      <HistoryNav />
      <div className="flex min-w-0 flex-1 text-body font-medium">
        {/* Padded like the editor's title field, so the two titles line up. */}
        {typeof title === "string" ? <h1 className="px-1.5 py-1">{title}</h1> : title}
      </div>
      {children}
    </header>
  )
}

/**
 * The white surface a page's content sits on. On desktop its top corners are rounded except
 * where it meets the window: always on the right, and on the left once the sidebar is
 * collapsed. In a split view the `start` pane rounds both top corners, and the `end` pane's
 * left neighbour is that pane rather than the sidebar, so its corner stays round.
 */
export function Panel({
  as: Tag = "div",
  split,
  className,
  ...props
}: { as?: "div" | "main" | "section"; split?: "start" | "end" } & Omit<ComponentProps<"div">, "ref">) {
  return (
    <Tag
      className={cn(
        "bg-card transition-[border-radius] duration-200 md:rounded-tl-xl",
        split !== "end" && "md:group-data-[collapsed=true]/shell:rounded-tl-none",
        split === "start" && "md:rounded-tr-xl",
        className
      )}
      {...props}
    />
  )
}
