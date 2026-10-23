import { useEffect, useMemo, useState } from "react"
import type { Key, Selection } from "react-aria-components"

import type { Group } from "./grouping"
import type { LibraryGroup } from "./router"
import { clearSelection, getSelection, setSelection, useSelection } from "./selection"

const idOf = (key: Key) => String(key).slice(String(key).lastIndexOf("/") + 1)

/**
 * The library grid's cards and selection. `groups` are the cards shown, grouped by `grouping`; `scope` is the filter, a
 * change of which starts the selection afresh.
 *
 * A card's key is its diagram and, by subtag, where a diagram shows once under each of its subtags, the subtag too.
 * Invariant: within one grouping a card is the same card whatever the search or an edit: it keeps its thumbnail, and
 * its place as the grid's focus. `byGroup` holds the keys by group.
 *
 * Invariant: the selection store alone says which diagrams are selected, and holds only diagrams shown; the grid shows
 * it by copy, so a diagram's copies are selected together. The grid's own last selection is handed back only while it
 * says the same, as it carries where a Shift-click range starts (the card last toggled, by click, Space, right-click
 * or long press); a selection the marquee or the bar made starts afresh.
 */
export function useGridSelection(groups: Group[], grouping: LibraryGroup, scope: string) {
  const byGroup = useMemo(
    () => groups.map((g) => g.rows.map((r) => (grouping === "subtag" ? `${g.key}/${r.id}` : r.id))),
    [groups, grouping]
  )
  const keys = useMemo(() => byGroup.flat(), [byGroup])
  const selection = useSelection()
  const [picked, setPicked] = useState<Set<Key>>()
  const selectedKeys = useMemo(() => {
    const shown = new Set<Key>(keys.filter((k) => selection.has(idOf(k))))
    return picked && shown.symmetricDifference(picked).size === 0 ? picked : shown
  }, [keys, selection, picked])
  const onSelectionChange = (next: Selection) => {
    if (next === "all") return setSelection(keys.map(idOf))
    const ids = new Set(selection)
    for (const k of selectedKeys) if (!next.has(k)) ids.delete(idOf(k))
    for (const k of next) if (!selectedKeys.has(k)) ids.add(idOf(k))
    // A diagram's copies go together; the grid's own selection object keeps its range anchor.
    for (const k of keys) {
      if (ids.has(idOf(k))) next.add(k)
      else next.delete(k)
    }
    setPicked(next)
    setSelection(ids)
  }
  useEffect(() => clearSelection(), [scope])
  // Cards a search or edit hides leave the selection, so the bar only acts on what's shown.
  useEffect(() => {
    const shown = new Set(keys.map(idOf))
    setSelection([...getSelection()].filter((id) => shown.has(id)))
  }, [keys])
  return { byGroup, keys, selectedKeys, onSelectionChange }
}
