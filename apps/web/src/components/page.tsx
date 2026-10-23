import { createContext, isValidElement, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { arrive } from "@/lib/history"

import { HistoryNav } from "./history-nav"
import { SidebarToggle } from "./sidebar-toggle"

/** A page in the shell's content area: its header, then its panels, on the shell's grey. */
export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("flex min-w-0 flex-1 flex-col gap-2", className)} {...props} />
}

/**
 * A page's header, above its panels: back/forward and the title on the left, the page's own
 * actions on the right. The title is the page's heading (PageTitle, the default), a field of its
 * own (the editor's) padded like one so the two line up, or null for none yet; it takes the
 * header's type either way.
 */
export function PageHeader({ title = <PageTitle />, children }: { title?: ReactNode; children?: ReactNode }) {
  // A title of the page's own (the editor's field) shows its name, so its heading is for screen readers only.
  const own = isValidElement(title) && title.type !== PageTitle
  return (
    <header className="flex h-10 shrink-0 items-center gap-1.5 pr-2 pl-1.5">
      <SidebarToggle />
      <HistoryNav />
      {own && <PageTitle visuallyHidden />}
      <div className="contents text-label">{title}</div>
      <div className="flex-1" />
      {children}
    </header>
  )
}

/** Whether something in the panel is scrolled down, so its header draws a line over what's beneath. */
const Scrolled = createContext(false)

/**
 * A panel's header bar, above what scrolls in it: a title (or the panel's filters) on the left,
 * the panel's controls on the right. On narrow screens the controls wrap onto a row of their own.
 */
export function PanelHeader({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <header
      className={cn(
        "flex min-h-12 shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 border-b py-1.5 pr-2.5 pl-4 transition-colors",
        useContext(Scrolled) ? "border-border" : "border-transparent"
      )}
    >
      <div className="flex min-w-0 grow items-center text-label">{title}</div>
      {children}
    </header>
  )
}

/** The page on screen: its history entry, from the snapshot its route was rendered from, and its name (pageName). */
export const CurrentPage = createContext<{ entry: string; name?: string }>({ entry: "" })

/**
 * The page's heading, named from its route; nothing until the name is known. It keeps its width, so the header's
 * actions give way instead. A page arrived at takes focus here (see arrive), as it shows, and as a dialog that was open
 * over it closes. Not scrolled to: a page gone back to restores its own scroll. It's no control, so it draws no ring.
 * `children` is ignored: the name comes from the route.
 */
export function PageTitle({ visuallyHidden }: { visuallyHidden?: boolean; children?: ReactNode }) {
  const { entry, name } = useContext(CurrentPage)
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const take = () => ref.current && arrive(entry, ref.current)
    take()
    // `close` doesn't bubble; it's caught on the way down.
    document.addEventListener("close", take, true)
    return () => document.removeEventListener("close", take, true)
  }, [entry, name])
  if (!name) return null
  return (
    <h1 ref={ref} tabIndex={-1} className={cn("shrink-0 px-1.5 py-1 whitespace-nowrap outline-none", visuallyHidden && "sr-only")}>
      {name}
    </h1>
  )
}

/**
 * A page that has nothing to show yet: its header and an empty panel, where the real ones will be. It has no heading
 * until it has something to say (the diagram doesn't exist), so a page still loading doesn't take focus meant for it.
 */
export function EmptyPage({ children }: { children?: ReactNode }) {
  return (
    <Page>
      <PageHeader title={children ? undefined : null} />
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
  const [scrolled, setScrolled] = useState(false)
  return (
    <Scrolled.Provider value={scrolled}>
      <Tag
        // Scroll events don't bubble, but they can be caught on the way down, from whatever scrolls inside.
        onScrollCapture={(e) => setScrolled((e.target as Element).scrollTop > 0)}
        className={cn(
          "bg-card transition-[border-radius] duration-200 md:rounded-tl-xl",
          split !== "end" && "md:group-data-[collapsed=true]/shell:rounded-tl-none",
          split === "start" && "md:rounded-tr-xl",
          className
        )}
        {...props}
      />
    </Scrolled.Provider>
  )
}
