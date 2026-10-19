import { FILE_TREE_TAG_NAME } from "@pierre/trees"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import type { TagPath, TagRecord } from "@eos/core"
import { cn } from "@workspace/ui/lib/utils"

import { useEos } from "@/lib/eos"
import { DIAGRAM_MIME, readDraggedIds } from "@/lib/selection"
import { isTouchDragging, isTouchHolding, touchHoldCancel, touchHoldEnd, touchHoldStart } from "@/lib/touch-hold"
import { useIsMobile } from "@/lib/layout"
import { homeHref, navigate } from "@/lib/router"

import { Popover, PopoverAnchor, PopoverContent } from "@workspace/ui/components/popover"
import { Smile, Trash2 } from "lucide-react"

import { askConfirm } from "@/lib/ui-state"

import { EmojiGrid } from "./tag-emoji-picker"

/** Width of the "#"/emoji glyph at the start of a row's label; clicks there open the icon picker. */
const ICON_HIT = 20

/**
 * The tag tree, rendered by @pierre/trees. Tags become directory paths; each
 * visible segment is "<emoji or #> <name>" so the tree shows the icon inline.
 * Expand/collapse, keyboard nav and drag-to-reparent come from the library;
 * dropping diagram cards onto a row tags them.
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
  const { paths, toTag, toTree, counts, leaves } = useMemo(() => flatten(tags), [tags])
  const handlers = useRef({ toTag, counts, selected, sort, group })
  handlers.current = { toTag, counts, selected, sort, group }
  const syncing = useRef(false)
  const [dropTarget, setDropTarget] = useState<TagPath | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const [picker, setPicker] = useState<{ tag: TagPath; x: number; y: number } | null>(null)
  // The last picker stays put while the popover animates out, so it doesn't jump to the corner.
  const lastPicker = useRef(picker)
  if (picker) lastPicker.current = picker
  const shownPicker = picker ?? lastPicker.current
  useLeafStyles(host, leaves)
  // Bigger rows for fingers on phones. Read once: the phone drawer mounts its own tree.
  const mobile = useIsMobile()

  const { model } = useFileTree({
    paths,
    initialExpansion: "open",
    icons: { set: "none" },
    density: "default",
    itemHeight: mobile ? 40 : 32,
    flattenEmptyDirectories: false,
    sort: byTagPath,
    renderRowDecoration: ({ row }) => {
      const count = handlers.current.counts.get(
        handlers.current.toTag.get(row.path) ?? ""
      )
      return count === undefined ? null : { text: String(count) }
    },
    onSelectionChange: (selection) => {
      if (syncing.current) return
      // Ending a press-and-hold (a touch drag) selects the row; that isn't a tap.
      if (isTouchHolding()) return
      const tag = selection[0]
        ? handlers.current.toTag.get(selection[0])
        : undefined
      if (tag && tag !== handlers.current.selected)
        navigate(homeHref({ tag, sort: handlers.current.sort as never, group: handlers.current.group as never }))
    },
    dragAndDrop: {
      canDrop: ({ target }) => target.kind === "root" || !!target.directoryPath,
      onDropComplete: ({ draggedPaths, target }) => {
        const parent = target.directoryPath
          ? handlers.current.toTag.get(target.directoryPath)
          : null
        for (const p of draggedPaths) {
          const from = handlers.current.toTag.get(p)
          if (!from) continue
          const name = from.split("/").pop()!
          const to = parent ? `${parent}/${name}` : name
          if (to !== from && !to.startsWith(from + "/"))
            void eos.renameTag(from, to)
        }
      },
    },
    // Right-click only, so no action lane pushes the counts out of line with the nav items.
    composition: { contextMenu: { enabled: true, triggerMode: "right-click" } },
  })

  // Keep the tree in sync with the store, preserving which folders are open.
  const prevPaths = useRef(paths)
  useEffect(() => {
    if (prevPaths.current === paths) return
    const prevToTag = flattenToTag(prevPaths.current)
    const closed = new Set<TagPath>()
    for (const p of prevPaths.current) {
      const item = model.getItem(p)
      if (item && "isExpanded" in item && !item.isExpanded())
        closed.add(prevToTag.get(p)!)
    }
    syncing.current = true
    model.resetPaths(paths, {
      initialExpandedPaths: paths.filter((p) => !closed.has(toTag.get(p)!)),
    })
    syncing.current = false
    prevPaths.current = paths
  }, [model, paths, toTag])

  // Reflect the active tag filter as the tree's selection.
  useEffect(() => {
    syncing.current = true
    for (const p of model.getSelectedPaths()) model.getItem(p)?.deselect()
    const target = selected ? toTree.get(selected) : undefined
    if (target) model.getItem(target)?.select()
    syncing.current = false
  }, [model, selected, toTree, paths])

  const rowFromEvent = (e: React.DragEvent): TagPath | null => {
    for (const node of e.nativeEvent.composedPath()) {
      const path =
        node instanceof HTMLElement ? node.getAttribute("data-item-path") : null
      if (path) return toTag.get(path) ?? null
    }
    return null
  }

  /** If the pointer is over a row's leading icon glyph, returns that row's tag and anchor point. */
  const iconHit = (e: React.MouseEvent | React.PointerEvent) => {
    let row: HTMLElement | null = null
    let content: HTMLElement | null = null
    for (const node of e.nativeEvent.composedPath()) {
      if (!(node instanceof HTMLElement)) continue
      if (!content && node.getAttribute("data-item-section") === "content") content = node
      if (node.hasAttribute("data-item-path")) {
        row = node
        break
      }
    }
    if (!row || !content) return null
    const r = content.getBoundingClientRect()
    if (e.clientX < r.left - 2 || e.clientX > r.left + ICON_HIT) return null
    const tag = toTag.get(row.getAttribute("data-item-path")!)
    return tag ? { tag, x: r.left, y: row.getBoundingClientRect().bottom } : null
  }
  // Capture runs on the host before the tree's own handlers, so we can keep the row from selecting.
  const swallowIcon = (e: React.MouseEvent | React.PointerEvent) => {
    if (e.button !== 0 || !iconHit(e)) return
    e.stopPropagation()
    e.preventDefault()
  }

  const currentEmoji = shownPicker ? findEmoji(tags, shownPicker.tag) : null

  return (
    <div
      ref={host}
      onTouchStartCapture={touchHoldStart}
      onTouchMoveCapture={(e) => {
        if (!isTouchDragging()) return touchHoldCancel()
        // The tree doesn't redraw its drop highlight during touch drags, so mark the row under the finger.
        const t = e.touches[0]
        const root = host.current?.querySelector(FILE_TREE_TAG_NAME)?.shadowRoot
        const row = t && root?.elementFromPoint(t.clientX, t.clientY)?.closest<HTMLElement>("[data-item-path]:not([data-item-dragging]):not([data-file-tree-drag-preview])")
        highlightRow(host.current, row?.getAttribute("data-item-path") ?? null)
      }}
      onTouchEndCapture={() => {
        touchHoldEnd()
        highlightRow(host.current, null)
      }}
      onTouchCancelCapture={() => {
        touchHoldEnd()
        highlightRow(host.current, null)
      }}
      onPointerDownCapture={swallowIcon}
      onMouseDownCapture={swallowIcon}
      onClickCapture={(e) => {
        const hit = e.button === 0 ? iconHit(e) : null
        if (!hit) return
        e.stopPropagation()
        e.preventDefault()
        setPicker(hit)
      }}
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        dropTarget && "eos-tag-tree-dropping"
      )}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DIAGRAM_MIME)) return
        const tag = rowFromEvent(e)
        if (!tag) return setDropTarget(null)
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setDropTarget(tag)
        highlightRow(host.current, toTree.get(tag) ?? null)
      }}
      onDragLeave={() => {
        setDropTarget(null)
        highlightRow(host.current, null)
      }}
      onDrop={(e) => {
        const tag = rowFromEvent(e)
        const ids = readDraggedIds(e.dataTransfer)
        setDropTarget(null)
        highlightRow(host.current, null)
        if (!tag || !ids.length) return
        e.preventDefault()
        for (const id of ids) void eos.addTags(id, [tag])
      }}
    >
      <FileTree
        model={model}
        className="block min-h-0 flex-1"
        style={TREE_STYLE}
        renderContextMenu={(item, ctx) => {
          const tag = toTag.get(item.path)
          if (!tag) return null
          const menuItem = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-accent [&_svg]:size-4"
          return (
            <div className="min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  const r = ctx.anchorRect
                  ctx.close({ restoreFocus: false })
                  setPicker({ tag, x: r.left, y: r.bottom })
                }}
              >
                <Smile className="text-muted-foreground" /> Change icon
              </button>
              <button
                type="button"
                className={cn(menuItem, "text-destructive")}
                onClick={async () => {
                  ctx.close()
                  if (await askConfirm(`Remove “${tag}” from every diagram? Nested tags are removed too.`)) void eos.deleteTag(tag)
                }}
              >
                <Trash2 /> Delete tag
              </button>
            </div>
          )
        }}
      />
      <Popover open={!!picker} onOpenChange={(open) => !open && setPicker(null)}>
        <PopoverAnchor asChild>
          <span className="pointer-events-none fixed size-px" style={{ left: shownPicker?.x ?? 0, top: shownPicker?.y ?? 0 }} />
        </PopoverAnchor>
        <PopoverContent align="start" className="w-[272px] p-3">
          {shownPicker && (
            <EmojiGrid
              current={currentEmoji}
              onChoose={(emoji) => {
                void eos.setTagEmoji(shownPicker.tag, emoji)
                setPicker(null)
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

// Match the sidebar nav items: 32px rows, 10px padding and gap, 8px radius, 13px text.
const TREE_STYLE = {
  "--trees-bg-override": "transparent",
  "--trees-fg-override": "var(--eos-muted)",
  "--trees-fg-muted-override": "var(--eos-faint)",
  "--trees-selected-bg-override": "var(--eos-raised)",
  "--trees-selected-fg-override": "var(--eos-body)",
  "--trees-selected-focused-border-color-override": "transparent",
  "--trees-theme-list-hover-bg": "color-mix(in srgb, var(--eos-raised) 30%, transparent)",
  "--trees-accent-override": "var(--eos-champagne)",
  "--trees-focus-ring-color-override": "var(--eos-line-active)",
  "--trees-focus-ring-width-override": "1px",
  "--trees-border-radius-override": "calc(var(--radius) * 0.8)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "var(--eos-fs-body)",
  "--trees-font-weight-semibold-override": "500",
  "--trees-item-padding-x-override": "10px",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-row-gap-override": "10px",
  "--trees-padding-inline-override": "0px",
  "--trees-level-gap-override": "1px", // yields an 18px indent per level, as in the Figma
  "--trees-scrollbar-gutter-override": "0px",
  "--trees-indent-guide-bg-override": "transparent",
  "--trees-icon-width-override": "16px",
} as CSSProperties

/** Marks the row under a dragged card. Rows live in the tree's shadow root. */
function highlightRow(wrapper: HTMLElement | null, treePath: string | null) {
  const root = wrapper?.querySelector(FILE_TREE_TAG_NAME)?.shadowRoot
  if (!root) return
  root.querySelectorAll<HTMLElement>("[data-eos-drop]").forEach((el) => el.removeAttribute("data-eos-drop"))
  if (!treePath) return
  const row = root.querySelector<HTMLElement>(`[data-item-path="${CSS.escape(treePath)}"]`)
  row?.setAttribute("data-eos-drop", "")
}

/** Hides the expand chevron on tags without children (the tree treats every tag as a folder). */
function useLeafStyles(wrapper: React.RefObject<HTMLDivElement | null>, leaves: string[]) {
  useEffect(() => {
    let raf = 0
    const apply = () => {
      const root = wrapper.current?.querySelector(FILE_TREE_TAG_NAME)?.shadowRoot
      if (!root) return void (raf = requestAnimationFrame(apply))
      let style = root.querySelector<HTMLStyleElement>("style[data-eos-leaves]")
      if (!style) {
        style = document.createElement("style")
        style.setAttribute("data-eos-leaves", "")
        root.append(style)
      }
      style.textContent = [
        // Context menu opens on right-click; don't reserve the button lane.
        `[data-item-section="action"] { display: none; }`,
        // Drop target for dragged diagram cards, and for a tag dragged within the tree.
        `[data-eos-drop], [data-item-drag-target="true"] { background: color-mix(in srgb, var(--eos-champagne) 14%, transparent) !important; color: var(--eos-body) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--eos-champagne) 55%, transparent); }`,
        // The leading glyph opens the icon picker.
        `[data-item-section="content"] { cursor: default; }`,
        // The floating copy of a touch-dragged tag sits under the finger; let hit-testing see the row beneath.
        `[data-file-tree-drag-preview] { pointer-events: none; translate: 0 -44px; opacity: 1 !important; background: var(--eos-raised) !important; color: var(--eos-body) !important; border-radius: calc(var(--radius) * 0.8); box-shadow: 0 10px 28px rgb(0 0 0 / 0.35), inset 0 0 0 1px var(--eos-line-active); }`,
        // Press-and-hold drags a tag; don't show iOS's text callout or selection.
        `[data-item-path] { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }`,
        // Only show the focused-row ring while the tree itself has keyboard focus.
        `:host(:not(:focus-within)) [data-item-focused], :host(:not(:focus-within)) [data-item-focused]::before, :host(:not(:focus-within)) [data-item-focused]::after { outline: none !important; box-shadow: none !important; border-color: transparent !important; }`,
        ...leaves.map((p) => `[data-item-path="${CSS.escape(p)}"] [data-item-section="icon"] { visibility: hidden; }`),
      ].join("\n")
    }
    apply()
    return () => cancelAnimationFrame(raf)
  }, [wrapper, leaves])
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/**
 * Orders tree paths alphabetically by tag name, segment by segment, ignoring the
 * emoji or "#" that starts each segment. Parents come before their children.
 */
function byTagPath(a: { segments: readonly string[] }, b: { segments: readonly string[] }): number {
  const name = (segment: string) => segment.slice(segment.indexOf(" ") + 1)
  for (let i = 0; i < Math.min(a.segments.length, b.segments.length); i++) {
    const order = collator.compare(name(a.segments[i]), name(b.segments[i]))
    if (order) return order
  }
  return a.segments.length - b.segments.length
}

function segment(tag: TagRecord): string {
  return `${tag.emoji ?? "#"} ${tag.path.split("/").pop()}`
}

function flatten(tags: TagRecord[]) {
  const paths: string[] = []
  const toTag = new Map<string, TagPath>()
  const toTree = new Map<TagPath, string>()
  const countMap = new Map<TagPath, number>()
  const leaves: string[] = []
  const walk = (list: TagRecord[], prefix: string) => {
    for (const t of list) {
      const p = `${prefix}${segment(t)}/`
      paths.push(p)
      toTag.set(p, t.path)
      toTree.set(t.path, p)
      countMap.set(t.path, t.count)
      if (!t.children.length) leaves.push(p)
      walk(t.children, p)
    }
  }
  walk(tags, "")
  return { paths, toTag, toTree, counts: countMap, leaves }
}

function flattenToTag(paths: string[]): Map<string, TagPath> {
  const m = new Map<string, TagPath>()
  for (const p of paths)
    m.set(
      p,
      p
        .split("/")
        .filter(Boolean)
        .map((seg) => seg.slice(seg.indexOf(" ") + 1))
        .join("/")
    )
  return m
}

function findEmoji(tags: TagRecord[], path: TagPath): string | null {
  for (const t of tags) {
    if (t.path === path) return t.emoji
    const found = findEmoji(t.children, path)
    if (found) return found
  }
  return null
}
