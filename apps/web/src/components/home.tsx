import { Plus, Search, X } from "lucide-react"
import { useState } from "react"

import type { LibrarySort } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"

import { useEos, useLibrary, useTags } from "@/lib/eos"
import { diagramHref, homeHref, navigate, type Route } from "@/lib/router"

import { DiagramCard } from "./diagram-card"

export function Home({ route }: { route: Extract<Route, { name: "home" }> }) {
  const eos = useEos()
  const [query, setQuery] = useState("")
  const rows = useLibrary({ query, starred: route.starred, tags: route.tag ? [route.tag] : [], sort: route.sort })
  const tags = useTags()
  const emoji = route.tag ? findEmoji(tags ?? [], route.tag) : null

  const create = async () => {
    const id = await eos.createDiagram({ tags: route.tag ? [route.tag] : [] })
    if (route.starred) await eos.setStarred(id, true)
    navigate(diagramHref(id))
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card">
      <header className="flex items-center gap-2 border-b border-border py-3.5 pr-4 pl-6">
        <h1 className="flex-1 text-xl font-light">Diagrams</h1>
        <div className="relative w-[280px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search diagrams" className="pl-8" />
        </div>
        <Button onClick={create}>
          <Plus /> New diagram
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2">
            {route.starred && <FilterChip label="Starred" href={homeHref({ tag: route.tag, sort: route.sort })} />}
            {route.tag && (
              <FilterChip
                label={route.tag}
                mono
                icon={emoji}
                href={homeHref({ starred: route.starred, sort: route.sort })}
              />
            )}
            {!route.starred && !route.tag && <span className="text-xs text-muted-foreground">All diagrams</span>}
          </div>
          <NativeSelect
            value={route.sort}
            onChange={(e) => navigate(homeHref({ starred: route.starred, tag: route.tag, sort: e.target.value as LibrarySort }), { replace: true })}
            className="w-[170px]"
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
      </div>
    </main>
  )
}

function FilterChip({ label, href, mono, icon }: { label: string; href: string; mono?: boolean; icon?: string | null }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-[var(--eos-line-active)] bg-accent py-0.5 pr-1.5 pl-2.5 text-xs">
      {icon && <span>{icon}</span>}
      <span className={mono ? "font-mono text-[var(--eos-champagne)]" : ""}>{label}</span>
      <a href={href} aria-label={`Remove ${label} filter`} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
        <X className="size-3" />
      </a>
    </span>
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
