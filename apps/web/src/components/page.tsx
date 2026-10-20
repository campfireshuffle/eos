import type { ComponentProps, ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { HistoryNav } from "./history-nav"
import { SidebarToggle } from "./sidebar-toggle"

/** A page in the shell's content area: its header, then its panels, on the shell's grey. */
export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("flex min-w-0 flex-1 flex-col gap-2", className)} {...props} />
}

/**
 * A page's header, above its panels: back/forward and the title on the left, the page's own
 * actions on the right. The title is a PageTitle, or a field of its own (the editor's)
 * padded like one so the two line up; it takes the header's type either way.
 */
export function PageHeader({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-1.5 pr-2 pl-1.5">
      <SidebarToggle />
      <HistoryNav />
      <div className="contents text-body font-medium">{title}</div>
      <div className="flex-1" />
      {children}
    </header>
  )
}

/**
 * A panel's header bar, above what scrolls in it: a title (or the panel's filters) on the left,
 * the panel's controls on the right. On narrow screens the controls wrap onto a row of their own.
 */
export function PanelHeader({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-border py-1.5 pr-2.5 pl-4">
      <div className="flex min-w-0 flex-1 items-center text-body">{title}</div>
      {children}
    </header>
  )
}

/** The page's heading. It keeps its width, so the header's actions give way instead. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="shrink-0 px-1.5 py-1 whitespace-nowrap">{children}</h1>
}

/** A page that has nothing to show yet: its header and an empty panel, where the real ones will be. */
export function EmptyPage({ children }: { children?: ReactNode }) {
  return (
    <Page>
      <PageHeader />
      <Panel className="flex flex-1 flex-col items-center justify-center gap-3 text-body text-muted-foreground">{children}</Panel>
    </Page>
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
}: { as?: "div" | "section"; split?: "start" | "end" } & Omit<ComponentProps<"div">, "ref">) {
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
