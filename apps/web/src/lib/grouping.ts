import type { DiagramIndexRow, LibrarySort, TagPath } from "@eos/core"
import { tagMatches } from "@eos/core"

import type { LibraryGroup } from "./router"

export interface Group {
  key: string
  label: string | null
  rows: DiagramIndexRow[]
}

/** Splits already-sorted rows into sections, keeping their order within each. */
export function groupRows(rows: DiagramIndexRow[], group: LibraryGroup, sort: LibrarySort, tag: TagPath | null): Group[] {
  if (group === "none") return [{ key: "all", label: null, rows }]
  const groups = new Map<string, Group>()
  const add = (key: string, label: string, row: DiagramIndexRow) => {
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, label, rows: [] }))
    g.rows.push(row)
  }

  if (group === "date") {
    const field = sort === "created" ? "createdAt" : "updatedAt"
    for (const row of rows) {
      const [key, label] = dateBucket(row[field])
      add(key, label, row)
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  // Group by the first tag level below the current filter (or top-level tags when unfiltered).
  for (const row of rows) {
    const subs = new Set<string>()
    for (const t of row.tags) {
      if (tag && !tagMatches(t, tag)) continue
      const rest = tag ? t.slice(tag.length + 1) : t
      const first = rest.split("/")[0]
      if (first) subs.add(first)
    }
    if (!subs.size) add("~", tag ? `No subtag` : "Untagged", row)
    for (const sub of subs) add(sub, sub, row)
  }
  // Named subtags alphabetically; the catch-all group last.
  return [...groups.values()].sort((a, b) => (a.key === "~" ? 1 : b.key === "~" ? -1 : a.key.localeCompare(b.key)))
}

/** Sortable key (newest first) and label for a timestamp. */
export function dateBucket(ms: number): [string, string] {
  const now = new Date()
  const d = new Date(ms)
  // Calendar dates, not 24-hour steps, so a day made 23 or 25 hours long by daylight saving still starts at midnight.
  const [y, m, date] = [now.getFullYear(), now.getMonth(), now.getDate()]
  const startOfDay = new Date(y, m, date).getTime()
  const startOfYesterday = new Date(y, m, date - 1).getTime()
  const startOfWeek = new Date(y, m, date - ((now.getDay() + 6) % 7)).getTime()
  const startOfMonth = new Date(y, m, 1).getTime()
  const startOfYear = new Date(y, 0, 1).getTime()
  if (ms >= startOfDay) return ["0", "Today"]
  if (ms >= startOfYesterday) return ["1", "Yesterday"]
  if (ms >= startOfWeek) return ["2", "This week"]
  if (ms >= startOfMonth) return ["3", "This month"]
  if (ms >= startOfYear) return ["4", "This year"]
  return [`5-${9999 - d.getFullYear()}`, String(d.getFullYear())]
}

/**
 * How long ago a timestamp was, for a card. Days are calendar days, as dateBucket counts them, so a card
 * never says "2 days ago" under a "Yesterday" heading.
 */
export function relativeTime(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return "Just now"
  if (min < 60) return `${min}m ago`
  // Whole hours: rounding would make 23h40m "24h", and so "Yesterday" for an edit made today.
  const h = Math.floor(min / 60)
  // Calendar days, as dateBucket counts them. Rounding absorbs a day made 23 or 25 hours long by daylight saving.
  const d = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000)
  // Hours while it's still the same day, which on a 25-hour day can be "24h ago".
  if (h < 24 || d === 0) return `${h}h ago`
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
