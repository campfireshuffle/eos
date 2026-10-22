import { useSyncExternalStore } from "react"

/** Library card selection (right-click or long press, then clicks; marquee; ⌘A) and the drag payload. */
export const DIAGRAM_MIME = "application/x-eos-diagrams"

let selected = new Set<string>()
let lastToggled: string | undefined
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
  if (next.size === selected.size && next.isSubsetOf(selected)) return
  selected = next
  listeners.forEach((l) => l())
}

export function toggleSelected(id: string) {
  lastToggled = id
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

/**
 * Moves focus off the selection bar before an action empties the selection. Call it first: the bar's actions go
 * inert when nothing is selected, which would drop the focused button's focus to the page.
 * `removing` (the selected cards are about to leave the view): the next unselected card, else the one before.
 * Otherwise the card last toggled, else the first selected one. Failing both, the library itself.
 */
export function focusOffSelection(removing: boolean) {
  if (!document.activeElement?.closest("[role=toolbar][aria-label=Selection]")) return
  const cards = [...document.querySelectorAll<HTMLElement>("[data-card-id]")]
  const isSelected = (card: HTMLElement) => selected.has(card.dataset.cardId!)
  let target: HTMLElement | undefined
  if (removing) {
    const last = cards.findLastIndex(isSelected)
    target = cards.slice(last + 1).find((c) => !isSelected(c)) ?? cards.slice(0, Math.max(last, 0)).findLast((c) => !isSelected(c))
  } else {
    target = cards.find((c) => c.dataset.cardId === lastToggled) ?? cards.find(isSelected)
  }
  ;(target ?? document.querySelector<HTMLElement>(".eos-library-scroller"))?.focus()
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
