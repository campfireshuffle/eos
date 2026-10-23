import { Plus, Search } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react"
import { GridList, GridListHeader, GridListSection, type GridListRenderProps, type Key, type Selection } from "react-aria-components"

import { findEmoji, type LibrarySort } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"

import { useEos, useLibrary, useTags } from "@/lib/eos"
import { groupRows } from "@/lib/grouping"
import { entryKey } from "@/lib/history"
import { diagramHref, homeHref, navigate, parseRoute, type LibraryGroup, type Route } from "@/lib/router"
import { useIsMobile } from "@/lib/layout"
import { startTypedSearchAtTop, useScrollRestoration } from "@/lib/scroll-restore"
import { clearSelection, getSelection, setSelection, useSelection } from "@/lib/selection"

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
  const view = { starred: route.starred, deleted: route.deleted, tags: route.tag ? [route.tag] : [], sort: route.sort }
  const library = useLibrary({ query, ...view })
  const rows = library?.rows
  // Search results are one list, best match first: grouped, the best match could sit under a later date or tag.
  // Decided by the search the shown rows were loaded with, so the view changes with the results, not a keystroke before.
  const searched = !!library?.filter.query?.trim()
  // Cards are keyed by the search and filter their rows were loaded with, so a new one is a new list: the card the
  // grid last focused is gone from it, and Tab lands on its first card, the best match.
  const scope = JSON.stringify([library?.filter.query?.trim(), library?.filter.tags, library?.filter.starred, library?.filter.deleted])
  const tags = useTags()
  // Back/forward returns to where you were. Phones scroll the page; desktop scrolls this pane.
  const mobile = useIsMobile()
  const scroller = useRef<HTMLDivElement>(null)
  const emoji = route.tag ? findEmoji(tags ?? [], route.tag) : null
  const empty = rows?.length === 0
  const groups = useMemo(
    () => groupRows(rows ?? [], searched ? "none" : route.group, route.sort, route.tag),
    [rows, searched, route.group, route.sort, route.tag]
  )
  // The grid draws its rows in a render after it's handed them, so it says once it has drawn every one of these.
  const keys = useMemo(() => groups.flatMap((g) => g.rows.map((r) => copyKey(scope, g.key, r.id))), [groups, scope])
  const [drawn, setDrawn] = useState<Key[]>()
  const drawnAll = empty || drawn === keys
  // Put back once the URL's own rows show: until then, the last view's rows are still on screen, or ones loaded for
  // typing not yet in the URL.
  const shown = !!library && JSON.stringify(library.filter) === JSON.stringify({ query: route.q, ...view }) && drawnAll
  useScrollRestoration(mobile ? null : scroller, entry, shown)
  // The cards are one grid, which owns focus, the keyboard and the selection. It shows the selection store, by copy: a
  // diagram under two groups is two copies, selected together.
  const selection = useSelection()
  // The grid's own last selection carries where a Shift-click range starts, so it's handed back while it still
  // matches the store; a selection made elsewhere (right-click, the marquee, the bar) starts afresh.
  const [own, setOwn] = useState<Set<Key>>()
  const selectedKeys = useMemo(() => {
    const keys = new Set<Key>(groups.flatMap((g) => g.rows.filter((r) => selection.has(r.id)).map((r) => copyKey(scope, g.key, r.id))))
    return own && own.size === keys.size && keys.isSubsetOf(own) ? own : keys
  }, [groups, selection, own, scope])
  const select = (keys: Selection) => {
    if (keys === "all") return setSelection(groups.flatMap((g) => g.rows.map((r) => r.id)))
    setOwn(keys)
    const next = new Set(selection)
    for (const k of selectedKeys) if (!keys.has(k)) next.delete(idOf(k))
    for (const k of keys) if (!selectedKeys.has(k)) next.add(idOf(k))
    setSelection(next)
  }
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
              onSelectionChange={select}
              className={groups[0]?.label ? "flex flex-col gap-7" : CARD_GRID}
              render={(props, { state }) => <DrawnGrid {...props} collection={state.collection} keys={keys} onDrawn={setDrawn} />}
            >
              {groups.map((g) =>
                g.label ? (
                  <GridListSection key={g.key} id={g.key} className={CARD_GRID}>
                    <GridListHeader className="col-span-full -mb-1">
                      <h2 className="flex items-baseline gap-2 text-caption font-medium text-muted-foreground">
                        {g.label}
                        <span className="text-caption tabular-nums">{g.rows.length}</span>
                      </h2>
                    </GridListHeader>
                    {g.rows.map((row) => (
                      <DiagramCard key={copyKey(scope, g.key, row.id)} id={copyKey(scope, g.key, row.id)} row={row} />
                    ))}
                  </GridListSection>
                ) : (
                  g.rows.map((row) => <DiagramCard key={copyKey(scope, g.key, row.id)} id={copyKey(scope, g.key, row.id)} row={row} />)
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

type Drawn = GridListRenderProps["state"]["collection"]

/** The grid's element. Once a commit has drawn a row for each of `keys`, hands `keys` to `onDrawn`. */
function DrawnGrid({
  collection,
  keys,
  onDrawn,
  ...props
}: ComponentProps<"div"> & { collection: Drawn; keys: Key[]; onDrawn: (keys: Key[]) => void }) {
  useLayoutEffect(() => {
    if (keys.every((k) => collection.getItem(k))) onDrawn(keys)
  }, [collection, keys, onDrawn])
  return <div {...props} />
}

/** A card's key in the grid: one per copy, as a diagram shows under each of its groups. */
const copyKey = (scope: string, group: string, id: string) => `${scope}${group}/${id}`
const idOf = (key: Key) => String(key).slice(String(key).lastIndexOf("/") + 1)

/**
 * The search box: the URL's search, with what the person has typed on top until it's written. Typing replaces the
 * history entry rather than adding one, at most every 150ms, as Safari throws once a page rewrites its URL more than
 * 100 times in 10 seconds.
 */
function useUrlSearch(entry: string, q: string) {
  // Typing, with the entry and the URL's search it was typed over. It shows only while both still hold, so a search set
  // elsewhere (back/forward, an agent, a link) shows at once, and isn't written over.
  const [draft, setDraft] = useState<{ entry: string; base: string; q: string }>()
  const latest = useRef(draft)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const write = () => {
    const d = latest.current
    const now = parseRoute(location.hash)
    if (!d || d.q === d.base || d.entry !== entryKey() || now.name !== "home" || now.q !== d.base) return false
    navigate(homeHref({ ...now, q: d.q }), { replace: true })
    return true
  }
  // Writes now, then once more at the end of each 150ms that brought more typing. Once there's nothing left to write,
  // the typing is either in the URL or was typed over a URL since left, so it's dropped.
  const tick = () => {
    timer.current = write() ? setTimeout(tick, 150) : undefined
    if (!timer.current) setDraft((latest.current = undefined))
  }
  return {
    query: draft && draft.entry === entry && draft.base === q ? draft.q : q,
    type: (text: string) => {
      setDraft((latest.current = { entry, base: q, q: text }))
      if (!timer.current) tick()
    },
    // Leaving the box, e.g. to open a result, writes typing still due, so Back returns to it.
    flush: () => void write(),
  }
}
