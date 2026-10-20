import { useSyncExternalStore } from "react"

/** Library card selection (right-click or long press, then clicks; marquee; ⌘A) and the drag payload. */
export const DIAGRAM_MIME = "application/x-eos-diagrams"

let selected = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb))

export function useSelection(): Set<string> {
  return useSyncExternalStore(subscribe, () => selected)
}

/** Whether `id` is selected; re-renders only when that flips, not on every selection change. */
export function useSelected(id: string): boolean {
  return useSyncExternalStore(subscribe, () => selected.has(id))
}

/** Replaces the selection. Same members as now is a no-op, so nothing re-renders. */
export function setSelection(ids: Iterable<string>) {
  const next = new Set(ids)
  if (next.size === selected.size && isSubset(next, selected)) return
  selected = next
  listeners.forEach((l) => l())
}

function isSubset(a: Set<string>, b: Set<string>) {
  for (const id of a) if (!b.has(id)) return false
  return true
}

export function toggleSelected(id: string) {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setSelection(next)
}

export function clearSelection() {
  if (selected.size) setSelection([])
}

export function getSelection() {
  return selected
}

/** Starts dragging one card, or the whole selection when the card is part of it. */
export function startCardDrag(e: React.DragEvent, id: string) {
  const ids = selected.has(id) ? [...selected] : [id]
  e.dataTransfer.effectAllowed = "copyLink"
  e.dataTransfer.setData(DIAGRAM_MIME, JSON.stringify(ids))
  e.dataTransfer.setData("text/plain", ids.length === 1 ? location.origin + `/#/d/${ids[0]}` : `${ids.length} diagrams`)
  const ghost = document.createElement("div")
  ghost.textContent = ids.length === 1 ? "1 diagram" : `${ids.length} diagrams`
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-100px",
    padding: "4px 10px",
    borderRadius: "999px",
    font: "500 12px var(--font-sans)",
    color: "var(--eos-on-primary)",
    background: "var(--eos-primary)",
  })
  document.body.append(ghost)
  // Sit below-right of the cursor so the row under it stays readable.
  e.dataTransfer.setDragImage(ghost, -16, -20)
  setTimeout(() => ghost.remove())
}

export function readDraggedIds(dt: DataTransfer): string[] {
  try {
    const ids = JSON.parse(dt.getData(DIAGRAM_MIME) || "[]")
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}
