import type { DiagramIndexRow, TagPath, TagRecord } from "./types"

export function normalizeTag(input: string): TagPath | null {
  const path = input
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .split("/")
    .map((part) => part.trim().replace(/\s+/g, "-"))
    .filter(Boolean)
    .join("/")
  return path || null
}

export function normalizeTags(input: string[]): TagPath[] {
  return [...new Set(input.map(normalizeTag).filter((t): t is TagPath => !!t))]
}

export function tagPrefixes(tags: TagPath[]): TagPath[] {
  const out = new Set<TagPath>()
  for (const tag of tags) {
    const parts = tag.split("/")
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"))
  }
  return [...out]
}

/** True when `tag` is `filter` or nested under it. */
export function tagMatches(tag: TagPath, filter: TagPath): boolean {
  return tag === filter || tag.startsWith(filter + "/")
}

export function buildTagTree(rows: DiagramIndexRow[], emoji: Record<TagPath, string | null>): TagRecord[] {
  const counts = new Map<TagPath, number>()
  for (const row of rows) {
    if (row.deletedAt) continue
    for (const prefix of row.tagPrefixes) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  const nodes = new Map<TagPath, TagRecord>()
  const roots: TagRecord[] = []
  for (const path of [...counts.keys()].sort()) {
    const node: TagRecord = { path, emoji: emoji[path] ?? null, count: counts.get(path)!, children: [] }
    nodes.set(path, node)
    const parent = path.includes("/") ? nodes.get(path.slice(0, path.lastIndexOf("/"))) : undefined
    ;(parent ? parent.children : roots).push(node)
  }
  return roots
}
