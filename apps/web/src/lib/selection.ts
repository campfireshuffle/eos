import { useSyncExternalStore } from "react"

/**
 * The library's selected diagrams, by id, and the drag payload. The library's grid shows and changes it (Space,
 * clicks while selecting, Shift-click, ⌘A, Esc, long press), as do right-click, the marquee and the selection bar.
 */
export const DIAGRAM_MIME = "application/x-eos-diagrams"

let selected = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb))

export function useSelection(): Set<string> {
  return useSyncExternalStore(subscribe, () => selected)
}

/**
 * Replaces the selection. Same members as now is a no-op, so nothing re-renders.
 * Invariant: emptying the selection never drops focus to the page. The bar's actions go inert when nothing is
 * selected (and its Tags menu closes), so focus inside them moves off first, while the old selection is known.
 * `removing`: the selected cards are leaving the view. It's the default for the implicit emptyings: home's prune
 * (of cards already gone), `toggleSelected` (un-toggling the last card) and the marquee (selecting nothing).
 */
export function setSelection(ids: Iterable<string>, { removing = true } = {}) {
  const next = new Set(ids)
  if (next.size === selected.size && next.isSubsetOf(selected)) return
  if (!next.size) focusOffSelection(removing)
  selected = next
  listeners.forEach((l) => l())
}

export function toggleSelected(id: string) {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setSelection(next)
}

export function clearSelection(removing = false) {
  if (selected.size) setSelection([], { removing })
}

export function getSelection() {
  return selected
}

/**
 * `removing`: the next unselected card, else the one before. Otherwise the card the grid last focused if it's
 * selected, else the first selected one. Focus never scrolls the library: a target out of view gives way to a card in
 * view (one that stays), else to the library itself. Focusing a card makes it the grid's.
 */
function focusOffSelection(removing: boolean) {
  const focus = document.activeElement
  if (!focus?.closest("[role=toolbar][aria-label=Selection], [data-selection-menu]")) return
  const scroller = document.querySelector<HTMLElement>(".eos-library-scroller")
  const cards = [...document.querySelectorAll<HTMLElement>("[data-card-id]")]
  const isSelected = (card: HTMLElement) => selected.has(card.dataset.cardId!)
  const stays = (card: HTMLElement) => !removing || !isSelected(card)
  const inView = (card: HTMLElement) => {
    const c = card.getBoundingClientRect()
    const s = scroller?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight)
    const top = Math.max(0, s.top)
    const bottom = Math.min(innerHeight, s.bottom)
    return c.bottom > top && c.top < bottom
  }
  let target: HTMLElement | undefined
  if (removing) {
    const last = cards.findLastIndex(isSelected)
    target = cards.slice(last + 1).find(stays) ?? cards.slice(0, Math.max(last, 0)).findLast(stays)
  } else {
    // The grid's Tab stop is the card it last focused.
    target = cards.find((c) => c.tabIndex === 0 && isSelected(c)) ?? cards.find(isSelected)
  }
  if (target && !inView(target)) target = cards.find((c) => stays(c) && inView(c))
  ;(target ?? scroller)?.focus({ preventScroll: true })
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
