import { PanelLeft, Settings, Star, Trash2 } from "lucide-react"
import { useState, type ReactNode } from "react"

import type { TagPath } from "@eos/core"
import { cn } from "@workspace/ui/lib/utils"

import { useCounts, useEos, useTags } from "@/lib/eos"
import { homeHref, type Route } from "@/lib/router"
import { toggleSidebar } from "@/lib/layout"
import { DIAGRAM_MIME, readDraggedIds } from "@/lib/selection"
import { setUi } from "@/lib/ui-state"

import { TagTree } from "./tag-tree"

export function Sidebar({ route, activeTag }: { route: Route; activeTag?: TagPath | null }) {
  const eos = useEos()
  const tags = useTags()
  const counts = useCounts()
  const home = route.name === "home" ? route : null
  const selectedTag = home?.tag ?? activeTag ?? null

  return (
    // On desktop the sidebar sits 8px in from the window, so the bottom gap matches the 14px side inset.
    <aside className="flex h-full w-full min-w-0 flex-col gap-0.5 overflow-hidden px-1.5 pt-2.5 pb-1.5 md:pb-3.5">
      <div className="flex items-center gap-2 px-2.5 pb-3">
        <a href={homeHref()} className="flex flex-1 items-center gap-2">
          {/* In light mode the ivory bird sits on a dark tile so it stays legible. */}
          <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--eos-primary)] dark:bg-transparent">
            <img src="/logo.png" alt="" className="size-6 object-contain dark:size-7" />
          </span>
          <span className="text-heading font-semibold tracking-tight">Eos</span>
        </a>
        <button
          type="button"
          aria-label="Hide sidebar"
          onClick={toggleSidebar}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <NavItem
        href={homeHref({ starred: true, sort: home?.sort, group: home?.group })}
        icon={<Star />}
        label="Starred"
        count={counts?.starred}
        active={!!home?.starred}
        onDropIds={(ids) => ids.forEach((id) => void eos.setStarred(id, true))}
      />

      {!!counts?.deleted && (
        <NavItem
          href={homeHref({ deleted: true, sort: home?.sort, group: home?.group })}
          icon={<Trash2 />}
          label="Deleted"
          count={counts.deleted}
          active={!!home?.deleted}
        />
      )}

      {!!tags?.length && <div className="px-2.5 pt-4 pb-1 text-caption font-medium text-[var(--eos-faint)]">Tags</div>}
      {!!tags?.length && <TagTree tags={tags} selected={selectedTag} sort={home?.sort} group={home?.group} />}

      {!tags?.length && <div className="flex-1" />}
      <button
        type="button"
        onClick={() => setUi({ settingsOpen: true })}
        className={NAV_ITEM}
      >
        <span className="flex size-4 items-center justify-center">
          <Settings />
        </span>
        <span className="flex-1 truncate text-left">Settings</span>
      </button>
    </aside>
  )
}


/** One row style for every sidebar item: links (Starred, Deleted) and the Settings button. */
const NAV_ITEM =
  "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-body text-muted-foreground outline-none transition-colors max-md:h-10 hover:bg-accent/30 hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--eos-line-active)] [&_svg]:size-4 [&_svg]:shrink-0"

function NavItem({
  href,
  icon,
  label,
  count,
  active,
  onDropIds,
}: {
  href: string
  icon: ReactNode
  label: string
  count?: number
  active?: boolean
  onDropIds?: (ids: string[]) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      onDragOver={(e) => {
        if (!onDropIds || !e.dataTransfer.types.includes(DIAGRAM_MIME)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (!onDropIds) return
        e.preventDefault()
        onDropIds(readDraggedIds(e.dataTransfer))
      }}
      className={cn(
        NAV_ITEM,
        active && "bg-accent font-medium text-foreground",
        over && "outline outline-1 outline-[var(--eos-champagne)]",
      )}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-caption text-[var(--eos-faint)] tabular-nums">{count}</span>}
    </a>
  )
}
