import { Plus, Search } from "lucide-react"
import { useEffect, useState } from "react"

import type { LibrarySort } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"

import { useEos, useLibrary, useTags } from "@/lib/eos"
import { groupRows } from "@/lib/grouping"
import { diagramHref, homeHref, navigate, type LibraryGroup, type Route } from "@/lib/router"
import { clearSelection } from "@/lib/selection"

import { DiagramCard } from "./diagram-card"
import { Marquee } from "./marquee"
import { SelectionBar } from "./selection-bar"
import { Pill } from "./pill"
import { HistoryNav } from "./history-nav"
import { SidebarToggle } from "./sidebar-toggle"

export function Home({ route }: { route: Extract<Route, { name: "home" }> }) {
  const eos = useEos()
  const [query, setQuery] = useState("")
  const rows = useLibrary({ query, starred: route.starred, deleted: route.deleted, tags: route.tag ? [route.tag] : [], sort: route.sort })
  const tags = useTags()
  const emoji = route.tag ? findEmoji(tags ?? [], route.tag) : null
  useEffect(() => clearSelection(), [route.tag, route.starred, route.deleted])

  const create = async () => {
    const id = await eos.createDiagram({ tags: route.tag ? [route.tag] : [] })
    if (route.starred) await eos.setStarred(id, true)
    navigate(diagramHref(id))
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card md:rounded-none md:rounded-tl-xl">
      <header className="flex items-center gap-2 border-b border-border py-3.5 pr-4 pl-4 md:pl-6">
        <SidebarToggle />
        <HistoryNav />
        <h1 className="flex-1 text-[15px] font-medium">{route.deleted ? "Recently deleted" : "Diagrams"}</h1>
        <div className="relative w-[280px] max-md:hidden">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search diagrams" className="pl-8" />
        </div>
        <Button onClick={create} aria-label="New diagram">
          <Plus /> <span className="max-sm:hidden">New diagram</span>
        </Button>
      </header>
      <div className="relative border-b border-border px-4 py-2.5 md:hidden">
        <Search className="pointer-events-none absolute top-1/2 left-6.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search diagrams" className="pl-8" />
      </div>

      <Marquee className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter chips take their own row on narrow screens; the view controls stay right-aligned. */}
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 empty:hidden sm:basis-0">
            {route.starred && (
              <Pill removeHref={homeHref({ tag: route.tag, sort: route.sort, group: route.group })} removeLabel="Remove Starred filter">
                Starred
              </Pill>
            )}
            {route.tag && (
              <Pill icon={emoji} removeHref={homeHref({ starred: route.starred, sort: route.sort, group: route.group })} removeLabel={`Remove ${route.tag} filter`}>
                {route.tag}
              </Pill>
            )}
          </div>
          <div className="ml-auto flex gap-2 max-sm:w-full">
            <NativeSelect
              value={route.group}
              onChange={(e) =>
                navigate(homeHref({ ...route, group: e.target.value as LibraryGroup }), { replace: true })
              }
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
        </div>

        {rows && rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            {route.deleted
              ? "Nothing in Recently deleted."
              : query || route.tag || route.starred
                ? "No diagrams match."
                : "No diagrams yet."}
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
                  <h2 className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
                    {g.label}
                    <span className="text-[var(--eos-faint)] tabular-nums">{g.rows.length}</span>
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
      <SelectionBar deleted={route.deleted} />
    </main>
  )
}


function findEmoji(tags: { path: string; emoji: string | null; children: unknown[] }[], path: string): string | null {
  for (const t of tags) {
    if (t.path === path) return t.emoji
    const found = findEmoji(t.children as never, path)
    if (found) return found
  }
  return null
}
