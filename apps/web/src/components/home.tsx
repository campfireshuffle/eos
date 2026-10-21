import { Plus, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { findEmoji, type LibrarySort } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"

import { useEos, useLibrary, useTags } from "@/lib/eos"
import { groupRows } from "@/lib/grouping"
import { useHistoryEntry } from "@/lib/history"
import { diagramHref, homeHref, navigate, parseRoute, type LibraryGroup, type Route } from "@/lib/router"
import { useIsMobile } from "@/lib/layout"
import { useScrollRestoration } from "@/lib/scroll-restore"
import { clearSelection, getSelection, setSelection } from "@/lib/selection"

import { CardHint, DiagramCard } from "./diagram-card"
import { Marquee } from "./marquee"
import { SelectionBar } from "./selection-bar"
import { Pill } from "./pill"
import { Page, PageHeader, PageTitle, Panel, PanelHeader } from "./page"

export function Home({ route }: { route: Extract<Route, { name: "home" }> }) {
  const eos = useEos()
  // Everything about the view lives in the URL, so back/forward and reload restore it.
  // The search box shows what's typed at once and the URL follows at most every 150ms,
  // as Safari throws once a page rewrites its URL more than 100 times in 10 seconds.
  const [query, setQuery] = useState(route.q)
  const entry = useHistoryEntry()
  // The URL's search as last written or read, and the history entry it belongs to.
  const synced = useRef({ entry, q: route.q })
  const typed = useRef(route.q)
  const throttle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const write = () => {
    const q = typed.current
    // Only into the entry the typing started in: once that's been left, its URL is the one to show.
    if ((history.state as { eosKey?: string } | null)?.eosKey !== synced.current.entry || q === synced.current.q) return false
    synced.current.q = q
    // Typing replaces the current history entry rather than adding one per keystroke.
    const now = parseRoute(location.hash)
    if (now.name === "home") navigate(homeHref({ ...now, q }), { replace: true })
    return true
  }
  // Writes now, then once more at the end of each 150ms that brought more typing.
  const tick = () => void (throttle.current = write() ? setTimeout(tick, 150) : undefined)
  const type = (q: string) => {
    setQuery(q)
    typed.current = q
    if (!throttle.current) tick()
  }
  // A search set elsewhere (back/forward, an agent, a link) shows in the box; our own write coming back changes nothing.
  useEffect(() => {
    if (entry === synced.current.entry && route.q === synced.current.q) return
    synced.current = { entry, q: route.q }
    typed.current = route.q
    clearTimeout(throttle.current)
    throttle.current = undefined
    setQuery(route.q)
  }, [entry, route.q])
  useEffect(() => () => clearTimeout(throttle.current), [])
  // Leaving the box, e.g. to open a result, saves typing still due so back returns to it.
  const flush = () => void write()
  const rows = useLibrary({ query, starred: route.starred, deleted: route.deleted, tags: route.tag ? [route.tag] : [], sort: route.sort })
  const tags = useTags()
  // Back/forward returns to where you were. Phones scroll the page; desktop scrolls this pane.
  const mobile = useIsMobile()
  const scroller = useRef<HTMLDivElement>(null)
  useScrollRestoration(mobile ? null : scroller, rows !== undefined, [homeHref({ ...route, q: "" }), mobile])
  const emoji = route.tag ? findEmoji(tags ?? [], route.tag) : null
  useEffect(() => clearSelection(), [route.tag, route.starred, route.deleted])
  // Cards a search or edit hides leave the selection, so the bar only acts on what's shown.
  useEffect(() => {
    if (!rows) return
    const shown = new Set(rows.map((r) => r.id))
    setSelection([...getSelection()].filter((id) => shown.has(id)))
  }, [rows])

  const create = async () => {
    const id = await eos.createDiagram({ tags: route.tag ? [route.tag] : [] })
    if (route.starred) await eos.setStarred(id, true)
    navigate(diagramHref(id))
  }

  return (
    <Page className="relative">
      {/* Sticks to the top on phones, where the page itself scrolls. */}
      <div className="max-md:sticky max-md:top-0 max-md:z-20 max-md:bg-background">
        <PageHeader title={<PageTitle>{route.deleted ? "Deleted" : "Diagrams"}</PageTitle>}>
          <div className="relative w-[280px] max-md:hidden">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => type(e.target.value)}
              onFocus={() => eos.prepareSearch()}
              onBlur={flush}
              placeholder="Search"
              aria-label="Search diagrams"
              className="pl-8"
            />
          </div>
          <Button onClick={create} aria-label="New diagram">
            <Plus /> <span className="max-sm:hidden">New diagram</span>
          </Button>
        </PageHeader>
        <div className="relative px-2 py-1.5 md:hidden">
          <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => type(e.target.value)}
            onFocus={() => eos.prepareSearch()}
            onBlur={flush}
            placeholder="Search"
            aria-label="Search diagrams"
            className="pl-8"
          />
        </div>
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col md:overflow-hidden">
        {/* Filters and view controls stay put above the cards, like the editor's panel headers. */}
        <PanelHeader
          title={
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {route.starred && (
                <Pill removeHref={homeHref({ ...route, starred: false })} removeLabel="Remove Starred filter">
                  Starred
                </Pill>
              )}
              {route.tag && (
                <Pill icon={emoji} removeHref={homeHref({ ...route, tag: null })} removeLabel={`Remove ${route.tag} filter`}>
                  {route.tag}
                </Pill>
              )}
            </div>
          }
        >
          <div className="ml-auto flex gap-2 max-sm:w-full">
            <NativeSelect
              value={route.group}
              onChange={(e) => navigate(homeHref({ ...route, group: e.target.value as LibraryGroup }), { replace: true })}
              className="w-[150px] shrink-0 max-sm:w-auto max-sm:flex-1"
              aria-label="Group by"
            >
              <NativeSelectOption value="date">Group: Date</NativeSelectOption>
              <NativeSelectOption value="subtag">Group: Subtag</NativeSelectOption>
              <NativeSelectOption value="none">Group: None</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              value={route.sort}
              onChange={(e) => navigate(homeHref({ ...route, sort: e.target.value as LibrarySort }), { replace: true })}
              className="w-[150px] shrink-0 max-sm:w-auto max-sm:flex-1"
              aria-label="Sort"
            >
              <NativeSelectOption value="modified">Sort: Modified</NativeSelectOption>
              <NativeSelectOption value="created">Sort: Created</NativeSelectOption>
              <NativeSelectOption value="title">Sort: Title</NativeSelectOption>
            </NativeSelect>
          </div>
        </PanelHeader>
        {/* The bottom padding lets the last row scroll clear of the selection bar floating over it (bar, offset and a gap). */}
        <Marquee
          scrollerRef={scroller}
          className="eos-library-scroller flex flex-1 flex-col gap-5 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:min-h-0 md:overflow-y-auto md:p-6 md:pb-24"
        >
          {rows && rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-body text-muted-foreground">
              {/* An empty library just shows the button; filters and Deleted say why nothing is listed. */}
              {route.deleted ? "Nothing deleted." : query || route.tag || route.starred ? "No diagrams match." : null}
              {!route.deleted && (
                <Button variant="outline" onClick={create}>
                  <Plus /> New diagram
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-7">
              {groupRows(rows ?? [], route.group, route.sort, route.tag).map((g) => (
                <section key={g.key} className="flex flex-col gap-3">
                  {g.label && (
                    <h2 className="flex items-baseline gap-2 text-caption font-medium text-muted-foreground">
                      {g.label}
                      <span className="text-caption tabular-nums">{g.rows.length}</span>
                    </h2>
                  )}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                    {g.rows.map((row) => (
                      <DiagramCard key={`${g.key}:${row.id}`} row={row} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Marquee>
      </Panel>
      <CardHint />
      <SelectionBar deleted={route.deleted} />
    </Page>
  )
}
