import { ArrowUpToLine, ChevronRight, Smile, Trash2 } from "lucide-react"
import { useMemo, useRef, useState, type ReactNode } from "react"
import {
  Button as AriaButton,
  Collection,
  DropZone,
  Tree,
  TreeItem,
  TreeItemContent,
  useDragAndDrop,
  type DropOperation,
  type DropTarget,
  type Key,
} from "react-aria-components"

import type { TagPath, TagRecord } from "@eos/core"
import { Popover, PopoverAnchor, PopoverContent } from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useEos } from "@/lib/eos"
import { homeHref, navigate } from "@/lib/router"
import { DIAGRAM_MIME } from "@/lib/selection"
import { askConfirm } from "@/lib/ui-state"

import { EmojiGrid } from "./tag-emoji-picker"

/** Drag payload for a tag dragged within the tree. */
const TAG_MIME = "application/x-eos-tag"

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const nameOf = (path: TagPath) => path.split("/").pop()!
const parentOf = (path: TagPath) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null)
const isWithin = (path: TagPath, ancestor: TagPath) => path === ancestor || path.startsWith(ancestor + "/")

const DROP_HIGHLIGHT =
  "bg-[color-mix(in_srgb,var(--eos-champagne)_14%,transparent)] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--eos-champagne)_55%,transparent)]"

type Anchored = { tag: TagPath; x: number; y: number }

/**
 * The tag tree, built on React Aria's Tree (works with mouse, touch, keyboard and
 * screen readers). Tags are always alphabetical, so drags only ever drop *onto* a
 * tag (nesting under it) or onto the top-level zone; there are no between-row drops.
 * Dropping diagram cards onto a tag tags them.
 */
export function TagTree({
  tags,
  selected,
  sort,
  group,
}: {
  tags: TagRecord[]
  selected: TagPath | null
  sort?: string
  group?: string
}) {
  const eos = useEos()
  const sorted = useMemo(() => sortTags(tags), [tags])
  const withChildren = useMemo(() => collect(tags, (t) => t.children.length > 0), [tags])
  const [collapsed, setCollapsed] = useState<Set<TagPath>>(new Set())
  const expandedKeys = useMemo(() => new Set(withChildren.filter((p) => !collapsed.has(p))), [withChildren, collapsed])

  // The tags being dragged right now, to refuse drops into themselves and to show the top-level zone.
  const [dragging, setDragging] = useState<TagPath[]>([])
  const [picker, setPicker] = useState<Anchored | null>(null)
  const [menu, setMenu] = useState<Anchored | null>(null)

  const moveTo = (from: TagPath, parent: TagPath | null) => {
    const to = parent ? `${parent}/${nameOf(from)}` : nameOf(from)
    if (to !== from && !(parent && isWithin(parent, from))) void eos.renameTag(from, to)
  }

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ [TAG_MIME]: String(key), "text/plain": `#${String(key)}` })),
    acceptedDragTypes: [TAG_MIME, DIAGRAM_MIME],
    onDragStart: (e) => setDragging([...e.keys].map(String)),
    onDragEnd: () => setDragging([]),
    getDropOperation: (target: DropTarget, types, allowed): DropOperation => {
      // Alphabetical order means there's no "between" to drop into.
      if (target.type !== "item" || target.dropPosition !== "on") return "cancel"
      const key = String(target.key)
      if (types.has(DIAGRAM_MIME)) return allowed.includes("copy") ? "copy" : allowed[0]
      if (dragging.some((d) => isWithin(key, d) || parentOf(d) === key)) return "cancel"
      return "move"
    },
    onMove: (e) => {
      if (e.target.dropPosition !== "on") return
      for (const key of e.keys) moveTo(String(key), String(e.target.key))
    },
    onItemDrop: async (e) => {
      const tag = String(e.target.key)
      for (const item of e.items) {
        if (item.kind !== "text" || !item.types.has(DIAGRAM_MIME)) continue
        const ids = parseIds(await item.getText(DIAGRAM_MIME))
        for (const id of ids) void eos.addTags(id, [tag])
      }
    },
  })

  const draggingNested = dragging.some((d) => d.includes("/"))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tree
        aria-label="Tags"
        items={sorted}
        expandedKeys={expandedKeys}
        onExpandedChange={(keys: Set<Key>) => setCollapsed(new Set(withChildren.filter((p) => !keys.has(p))))}
        onAction={(key) => navigate(homeHref({ tag: String(key), sort: sort as never, group: group as never }))}
        dragAndDropHooks={dragAndDropHooks}
        className="flex min-h-0 flex-col gap-0.5 overflow-y-auto outline-none"
      >
        {function renderTag(tag: TagRecord): ReactNode {
          return (
            <TreeItem
              id={tag.path}
              textValue={tag.path}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ tag: tag.path, x: e.clientX, y: e.clientY })
              }}
              className={({ isDropTarget, isDragging, isFocusVisible, isHovered }) =>
                cn(
                  "flex h-8 shrink-0 cursor-default items-center rounded-md pr-2.5 text-body text-muted-foreground outline-none select-none max-md:h-10 [-webkit-touch-callout:none]",
                  isHovered && "bg-accent/30 text-foreground",
                  tag.path === selected && "bg-accent font-medium text-foreground",
                  isDropTarget && DROP_HIGHLIGHT,
                  isDragging && "opacity-50",
                  isFocusVisible && "ring-1 ring-[var(--eos-line-active)]",
                )
              }
            >
              <TreeItemContent>
                {({ hasChildItems, isExpanded, level }) => (
                  <div className="flex w-full min-w-0 items-center gap-1" style={{ paddingLeft: 6 + (level - 1) * 18 }}>
                    {hasChildItems ? (
                      <AriaButton
                        slot="chevron"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                        className="flex size-4 shrink-0 items-center justify-center rounded text-[var(--eos-faint)] outline-none"
                      >
                        <ChevronRight className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")} />
                      </AriaButton>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <AriaButton
                      aria-label={`Change icon for ${tag.path}`}
                      onPress={(e) => {
                        const r = (e.target as HTMLElement).getBoundingClientRect()
                        setPicker({ tag: tag.path, x: r.left, y: r.bottom })
                      }}
                      className="flex h-6 min-w-5 shrink-0 items-center justify-center rounded px-0.5 outline-none hover:bg-accent"
                    >
                      {tag.emoji ?? "#"}
                    </AriaButton>
                    <span className="min-w-0 flex-1 truncate">{nameOf(tag.path)}</span>
                    <span className="shrink-0 text-caption text-[var(--eos-faint)] tabular-nums">{tag.count}</span>
                  </div>
                )}
              </TreeItemContent>
              <Collection items={tag.children}>{renderTag}</Collection>
            </TreeItem>
          )
        }}
      </Tree>

      {draggingNested && (
        <DropZone
          aria-label="Move to top level"
          getDropOperation={(types) => (types.has(TAG_MIME) ? "move" : "cancel")}
          onDrop={async (e) => {
            for (const item of e.items)
              if (item.kind === "text" && item.types.has(TAG_MIME)) moveTo(await item.getText(TAG_MIME), null)
          }}
          className={({ isDropTarget }) =>
            cn(
              "mt-1 flex h-8 shrink-0 items-center gap-2 rounded-md border border-dashed border-[var(--eos-line-active)] px-2.5 text-body text-muted-foreground max-md:h-10",
              isDropTarget && DROP_HIGHLIGHT,
            )
          }
        >
          <ArrowUpToLine className="size-4" /> Move to top level
        </DropZone>
      )}

      <AnchoredPopover at={menu} onClose={() => setMenu(null)} className="w-48 p-1">
        {menu && (
          <TagMenu
            tag={menu.tag}
            onChangeIcon={() => {
              setPicker(menu)
              setMenu(null)
            }}
            onMoveToTop={
              menu.tag.includes("/")
                ? () => {
                    moveTo(menu.tag, null)
                    setMenu(null)
                  }
                : undefined
            }
            onDelete={async () => {
              const tag = menu.tag
              setMenu(null)
              if (await askConfirm(`Remove “${tag}” from every diagram? Nested tags are removed too.`)) void eos.deleteTag(tag)
            }}
          />
        )}
      </AnchoredPopover>

      <AnchoredPopover at={picker} onClose={() => setPicker(null)} className="w-[272px] p-3">
        {picker && (
          <EmojiGrid
            current={findEmoji(tags, picker.tag)}
            onChoose={(emoji) => {
              void eos.setTagEmoji(picker.tag, emoji)
              setPicker(null)
            }}
          />
        )}
      </AnchoredPopover>
    </div>
  )
}

/** A popover pinned to a screen point. It keeps its last point and content while animating out. */
function AnchoredPopover({
  at,
  onClose,
  className,
  children,
}: {
  at: Anchored | null
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const last = useRef(at)
  const lastChildren = useRef(children)
  if (at) {
    last.current = at
    lastChildren.current = children
  }
  const shown = at ?? last.current
  return (
    <Popover open={!!at} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span className="pointer-events-none fixed size-px" style={{ left: shown?.x ?? 0, top: shown?.y ?? 0 }} />
      </PopoverAnchor>
      <PopoverContent align="start" className={className}>
        {at ? children : lastChildren.current}
      </PopoverContent>
    </Popover>
  )
}

function TagMenu({
  onChangeIcon,
  onMoveToTop,
  onDelete,
}: {
  tag: TagPath
  onChangeIcon: () => void
  onMoveToTop?: () => void
  onDelete: () => void
}) {
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-accent [&_svg]:size-4"
  return (
    <div className="flex flex-col">
      <button type="button" className={item} onClick={onChangeIcon}>
        <Smile className="text-muted-foreground" /> Change icon
      </button>
      {onMoveToTop && (
        <button type="button" className={item} onClick={onMoveToTop}>
          <ArrowUpToLine className="text-muted-foreground" /> Move to top level
        </button>
      )}
      <button type="button" className={cn(item, "text-destructive")} onClick={onDelete}>
        <Trash2 /> Delete tag
      </button>
    </div>
  )
}

function sortTags(tags: TagRecord[]): TagRecord[] {
  return [...tags]
    .sort((a, b) => collator.compare(nameOf(a.path), nameOf(b.path)))
    .map((t) => ({ ...t, children: sortTags(t.children) }))
}

function collect(tags: TagRecord[], keep: (t: TagRecord) => boolean): TagPath[] {
  return tags.flatMap((t) => [...(keep(t) ? [t.path] : []), ...collect(t.children, keep)])
}

function findEmoji(tags: TagRecord[], path: TagPath): string | null {
  for (const t of tags) {
    if (t.path === path) return t.emoji
    const found = findEmoji(t.children, path)
    if (found) return found
  }
  return null
}

function parseIds(json: string): string[] {
  try {
    const ids = JSON.parse(json)
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}
