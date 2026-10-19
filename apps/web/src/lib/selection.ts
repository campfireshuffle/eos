import { useSyncExternalStore } from "react"

/** Library card selection (marquee / ⌘-click / ⇧-click) and the drag payload. */
export const DIAGRAM_MIME = "application/x-eos-diagrams"

let selected = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function useSelection(): Set<string> {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => selected,
  )
}

export function setSelection(ids: Iterable<string>) {
  selected = new Set(ids)
  emit()
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
    color: "var(--eos-ink)",
    background: "var(--eos-ivory)",
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
