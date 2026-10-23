import { Plus, Search } from "lucide-react"
import { useMemo, useRef } from "react"
import { GridList, GridListHeader, GridListSection } from "react-aria-components"

import { findEmoji, type LibrarySort } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"

import { useEos, useLibrary, useTags } from "@/lib/eos"
import { useGridDrawn } from "@/lib/grid-drawn"
import { useGridSelection } from "@/lib/grid-selection"
import { groupRows } from "@/lib/grouping"
import { diagramHref, homeHref, navigate, type LibraryGroup, type Route } from "@/lib/router"
import { useIsMobile } from "@/lib/layout"
import { startTypedSearchAtTop, useScrollRestoration } from "@/lib/scroll-restore"
import { useUrlSearch } from "@/lib/url-search"

import { CARD_HINT_ID, CardHint, DiagramCard } from "./diagram-card"
import { Marquee } from "./marquee"
import { SelectionBar } from "./selection-bar"
import { Pill } from "./pill"
import { Page, PageHeader, Panel, PanelHeader } from "./page"

export function Home({ route, entry }: { route: Extract<Route, { name: "home" }>; entry: string }) {
  const eos = useEos()
  // Everything about the view lives in the URL, so back/forward and reload restore it.
  const { query, type, flush } = useUrlSearch(entry, route.q)
  // A search the person types starts at the top, where its best match is; back/forward, links and agents keep the
  // position the entry restores.
  const search = (q: string) => {
    if (q.trim() !== query.trim()) startTypedSearchAtTop(entry)
    type(q)
  }
  const filter = { query, starred: route.starred, deleted: route.deleted, tags: route.tag ? [route.tag] : [], sort: route.sort }
  const library = useLibrary(filter)
  const rows = library?.rows
  const empty = rows?.length === 0
  // Search results are one list, best match first: grouped, the best match could sit under a later date or tag.
  // Decided by the search the shown rows were loaded with, so the view changes with the results, not a keystroke before.
  // A grouped view's cards leave their sections for it, and go back once it's cleared, so those two changes draw the
  // cards afresh; the keystrokes between keep them (see useGridSelection).
  const grouping = library?.filter.query?.trim() ? "none" : route.group
  const groups = useMemo(() => groupRows(rows ?? [], grouping, route.sort, route.tag), [rows, grouping, route.sort, route.tag])
  // The cards are one grid, which owns focus, the keyboard and the selection.
  const { byGroup, keys, selectedKeys, onSelectionChange } = useGridSelection(
    groups,
    grouping,
    JSON.stringify([route.tag, route.starred, route.deleted])
  )
  // Back/forward returns to where you were, once the grid shows the URL's own view in full: until then, it shows the
  // last view's rows, or ones loaded for typing not yet in the URL. Phones scroll the page; desktop scrolls this pane.
  const urlRows = !!library && JSON.stringify(library.filter) === JSON.stringify({ ...filter, query: route.q })
  const mobile = useIsMobile()
  const scroller = useRef<HTMLDivElement>(null)
  const onDrawn = useScrollRestoration(mobile ? null : scroller, entry, urlRows ? JSON.stringify(route) : null, empty)
  const render = useGridDrawn(keys, onDrawn)
  const tags = useTags()
  const emoji = route.tag ? findEmoji(tags ?? [], route.tag) : null

  const create = async () => {
    const id = await eos.createDiagram({ tags: route.tag ? [route.tag] : [] })
    if (route.starred) await eos.setStarred(id, true)
    navigate(diagramHref(id))
  }

  return (
    <Page className="relative">
      {/* Sticks to the top on phones, where the page itself scrolls. */}
      <div className="max-md:sticky max-md:top-0 max-md:z-20 max-md:bg-background">
        <PageHeader>
          <div className="relative w-[280px] max-md:hidden">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => search(e.target.value)}
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
            onChange={(e) => search(e.target.value)}
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
          className={cn(
            "eos-library-scroller flex flex-1 flex-col p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:min-h-0 md:overflow-y-auto md:p-6 md:pb-24",
            empty && "items-center justify-center gap-3"
          )}
        >
          {/* Always there, so a search that empties the library is announced. An empty library just shows the
              button; filters and Deleted say why nothing is listed. */}
          <p role="status" className="text-body text-muted-foreground">
            {empty && (query || route.tag || route.starred ? "No diagrams match." : route.deleted ? "Nothing deleted." : null)}
          </p>
          {empty ? (
            !route.deleted && (
              <Button variant="outline" onClick={create}>
                <Plus /> New diagram
              </Button>
            )
          ) : (
            <GridList
              aria-label={route.deleted ? "Deleted diagrams" : "Diagrams"}
              aria-describedby={CARD_HINT_ID}
              layout="grid"
              selectionMode="multiple"
              selectionBehavior="toggle"
              // A press on a selected card selects on release, so dragging the selection doesn't first unselect it.
              shouldSelectOnPressUp
              selectedKeys={selectedKeys}
              onSelectionChange={onSelectionChange}
              className={groups[0]?.label ? "flex flex-col gap-7" : CARD_GRID}
              render={render}
            >
              {groups.map((g, i) =>
                g.label ? (
                  <GridListSection key={g.key} id={g.key} className={CARD_GRID}>
                    <GridListHeader className="col-span-full -mb-1">
                      <h2 className="flex items-baseline gap-2 text-caption font-medium text-muted-foreground">
                        {g.label}
                        <span className="text-caption tabular-nums">{g.rows.length}</span>
                      </h2>
                    </GridListHeader>
                    {g.rows.map((row, j) => (
                      <DiagramCard key={byGroup[i][j]} id={byGroup[i][j]} row={row} />
                    ))}
                  </GridListSection>
                ) : (
                  g.rows.map((row, j) => <DiagramCard key={byGroup[i][j]} id={byGroup[i][j]} row={row} />)
                )
              )}
            </GridList>
          )}
        </Marquee>
      </Panel>
      <CardHint />
      <SelectionBar deleted={route.deleted} />
    </Page>
  )
}

const CARD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
