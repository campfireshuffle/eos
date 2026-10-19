import { Hash, LayoutGrid, PanelLeft, Settings, Star } from "lucide-react"
import type { ReactNode } from "react"

import type { TagPath, TagRecord } from "@eos/core"
import { cn } from "@workspace/ui/lib/utils"

import { useCounts, useTags } from "@/lib/eos"
import { homeHref, type Route } from "@/lib/router"
import { toggleSidebar } from "@/lib/layout"
import { setUi } from "@/lib/ui-state"

import { TagEmojiPicker } from "./tag-emoji-picker"

export function Sidebar({ route, activeTag }: { route: Route; activeTag?: TagPath | null }) {
  const tags = useTags()
  const counts = useCounts()
  const home = route.name === "home" ? route : null
  const selectedTag = home?.tag ?? activeTag ?? null

  return (
    <aside className="flex h-full w-full min-w-0 flex-col gap-0.5 overflow-y-auto px-1.5 pt-2.5 pb-1.5">
      <div className="flex items-center gap-2 px-2.5 pb-3">
        <a href={homeHref()} className="flex flex-1 items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold tracking-tight">Eos</span>
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
        href={homeHref({ sort: home?.sort })}
        icon={<LayoutGrid />}
        label="All diagrams"
        count={counts?.all}
        active={!!home && !home.starred && !home.tag}
      />
      <NavItem
        href={homeHref({ starred: true, sort: home?.sort })}
        icon={<Star />}
        label="Starred"
        count={counts?.starred}
        active={!!home?.starred}
      />

      {!!tags?.length && <div className="px-2.5 pt-4 pb-1 text-xs font-medium text-[var(--eos-faint)]">Tags</div>}
      <TagTree tags={tags ?? []} selected={selectedTag} sort={home?.sort} depth={0} />

      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setUi({ settingsOpen: true })}
        className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4"
      >
        <Settings /> Settings
      </button>
    </aside>
  )
}

function TagTree({ tags, selected, sort, depth }: { tags: TagRecord[]; selected: TagPath | null; sort?: string; depth: number }) {
  return (
    <div className={cn("flex flex-col gap-0.5", depth > 0 && "pl-[18px]")}>
      {tags.map((tag) => (
        <div key={tag.path} className="flex flex-col gap-0.5">
          <NavItem
            href={homeHref({ tag: tag.path, sort: sort as never })}
            icon={
              <TagEmojiPicker path={tag.path} emoji={tag.emoji}>
                {tag.emoji ? <span className="text-[13px] leading-none">{tag.emoji}</span> : <Hash />}
              </TagEmojiPicker>
            }
            label={tag.path.split("/").pop()!}
            count={tag.count}
            active={selected === tag.path}
          />
          {tag.children.length > 0 && <TagTree tags={tag.children} selected={selected} sort={sort} depth={depth + 1} />}
        </div>
      ))}
    </div>
  )
}

function NavItem({ href, icon, label, count, active }: { href: string; icon: ReactNode; label: string; count?: number; active?: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        active && "bg-accent font-medium text-foreground",
      )}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-[var(--eos-faint)] tabular-nums">{count}</span>}
    </a>
  )
}
