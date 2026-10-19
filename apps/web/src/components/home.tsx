import { Plus, Search, X } from "lucide-react"
import { useEffect, useState } from "react"

import type { LibrarySort } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"

import { useEos, useLibrary, useTags } from "@/lib/eos"
import { diagramHref, homeHref, navigate, type Route } from "@/lib/router"
import { clearSelection, useSelection } from "@/lib/selection"

import { DiagramCard } from "./diagram-card"
import { Marquee } from "./marquee"
import { Pill } from "./pill"
import { HistoryNav } from "./history-nav"
import { SidebarToggle } from "./sidebar-toggle"

export function Home({ route }: { route: Extract<Route, { name: "home" }> }) {
  const eos = useEos()
  const [query, setQuery] = useState("")
  const rows = useLibrary({ query, starred: route.starred, tags: route.tag ? [route.tag] : [], sort: route.sort })
  const tags = useTags()
  const emoji = route.tag ? findEmoji(tags ?? [], route.tag) : null
  const selection = useSelection()
  useEffect(() => clearSelection(), [route.tag, route.starred])

  const create = async () => {
    const id = await eos.createDiagram({ tags: route.tag ? [route.tag] : [] })
    if (route.starred) await eos.setStarred(id, true)
    navigate(diagramHref(id))
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card md:rounded-none md:rounded-tl-xl">
      <header className="flex items-center gap-2 border-b border-border py-3.5 pr-4 pl-4 md:pl-6">
        <SidebarToggle />
        <HistoryNav />
        <h1 className="flex-1 text-xl font-light">Diagrams</h1>
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
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2">
            {route.starred && (
              <Pill removeHref={homeHref({ tag: route.tag, sort: route.sort })} removeLabel="Remove Starred filter">
                Starred
              </Pill>
            )}
            {route.tag && (
              <Pill icon={emoji} removeHref={homeHref({ starred: route.starred, sort: route.sort })} removeLabel={`Remove ${route.tag} filter`}>
                {route.tag}
              </Pill>
            )}
            {selection.size > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Pill>{selection.size} selected</Pill>
                <Button variant="ghost" size="xs" onClick={clearSelection} className="text-muted-foreground">
                  Clear <X />
                </Button>
              </span>
            )}
          </div>
          <NativeSelect
            value={route.sort}
            onChange={(e) => navigate(homeHref({ starred: route.starred, tag: route.tag, sort: e.target.value as LibrarySort }), { replace: true })}
            className="w-[150px] md:w-[170px]"
            aria-label="Sort"
          >
            <NativeSelectOption value="modified">Sort: Modified</NativeSelectOption>
            <NativeSelectOption value="created">Sort: Created</NativeSelectOption>
            <NativeSelectOption value="title">Sort: Title</NativeSelectOption>
          </NativeSelect>
        </div>

        {rows && rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            {query || route.tag || route.starred ? "No diagrams match." : "No diagrams yet."}
            <Button variant="outline" onClick={create}>
              <Plus /> New diagram
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {rows?.map((row) => <DiagramCard key={row.id} row={row} />)}
          </div>
        )}
      </Marquee>
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
