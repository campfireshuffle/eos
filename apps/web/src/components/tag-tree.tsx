import { FILE_TREE_TAG_NAME } from "@pierre/trees"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import type { TagPath, TagRecord } from "@eos/core"
import { cn } from "@workspace/ui/lib/utils"

import { useEos } from "@/lib/eos"
import { DIAGRAM_MIME, readDraggedIds } from "@/lib/selection"
import { homeHref, navigate } from "@/lib/router"

import { EmojiGrid } from "./tag-emoji-picker"

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
}: {
  tags: TagRecord[]
  selected: TagPath | null
  sort?: string
}) {
  const eos = useEos()
  const { paths, toTag, toTree, counts, leaves } = useMemo(() => flatten(tags), [tags])
  const handlers = useRef({ toTag, counts, selected, sort })
  handlers.current = { toTag, counts, selected, sort }
  const syncing = useRef(false)
  const [dropTarget, setDropTarget] = useState<TagPath | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  useLeafStyles(host, leaves)

  const { model } = useFileTree({
    paths,
    initialExpansion: "open",
    icons: { set: "none" },
    density: "default",
    itemHeight: 32,
    flattenEmptyDirectories: false,
    renderRowDecoration: ({ row }) => {
      const count = handlers.current.counts.get(
        handlers.current.toTag.get(row.path) ?? ""
      )
      return count === undefined ? null : { text: String(count) }
    },
    onSelectionChange: (selection) => {
      if (syncing.current) return
      const tag = selection[0]
        ? handlers.current.toTag.get(selection[0])
        : undefined
      if (tag && tag !== handlers.current.selected)
        navigate(homeHref({ tag, sort: handlers.current.sort as never }))
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

  return (
    <div
      ref={host}
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
          return (
            <div className="w-[272px] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
              <EmojiGrid
                current={tags.length ? findEmoji(tags, tag) : null}
                onChoose={(emoji) => {
                  void eos.setTagEmoji(tag, emoji)
                  ctx.close()
                }}
              />
            </div>
          )
        }}
      />
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
  "--trees-theme-list-hover-bg": "color-mix(in srgb, var(--eos-raised) 60%, transparent)",
  "--trees-accent-override": "var(--eos-champagne)",
  "--trees-focus-ring-color-override": "var(--eos-line-active)",
  "--trees-focus-ring-width-override": "1px",
  "--trees-border-radius-override": "calc(var(--radius) * 0.8)",
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "13px",
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
  root.querySelectorAll<HTMLElement>("[data-eos-drop]").forEach((el) => {
    el.removeAttribute("data-eos-drop")
    el.style.outline = ""
  })
  if (!treePath) return
  const row = root.querySelector<HTMLElement>(`[data-item-path="${CSS.escape(treePath)}"]`)
  if (row) {
    row.setAttribute("data-eos-drop", "")
    row.style.outline = "1px solid var(--eos-champagne)"
  }
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
        // Only show the focused-row ring while the tree itself has keyboard focus.
        `:host(:not(:focus-within)) [data-item-focused], :host(:not(:focus-within)) [data-item-focused]::before, :host(:not(:focus-within)) [data-item-focused]::after { outline: none !important; box-shadow: none !important; border-color: transparent !important; }`,
        ...leaves.map((p) => `[data-item-path="${CSS.escape(p)}"] [data-item-section="icon"] { visibility: hidden; }`),
      ].join("\n")
    }
    apply()
    return () => cancelAnimationFrame(raf)
  }, [wrapper, leaves])
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
