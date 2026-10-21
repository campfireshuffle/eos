/**
 * The preview's pan and zoom, as plain numbers: the diagram is drawn at scale `k` with its top-left
 * corner at (x, y) in the pane. Sizes are in CSS pixels; a diagram's is its natural (100%) size.
 */
export type View = { x: number; y: number; k: number }
export type Size = { w: number; h: number }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
// Fit shrinks big diagrams to the pane but won't blow small ones up past 200%.
export const FIT_MAX = 2
// Space left around a fitted diagram, on each side.
const MARGIN = 24
// However far it's panned, this much of the diagram stays in the pane on each axis.
const KEEP = 40

/** The scale that fits `diagram` in `pane`, at most `cap` (and at least the smallest zoom, in a pane too small for the margin). */
export const fitScale = (pane: Size, diagram: Size, cap = FIT_MAX) =>
  Math.max(MIN_ZOOM, Math.min((pane.w - 2 * MARGIN) / diagram.w, (pane.h - 2 * MARGIN) / diagram.h, cap))

/** The diagram fitted to the pane and centred in it. */
export function fit(pane: Size, diagram: Size, cap = FIT_MAX): View {
  const k = fitScale(pane, diagram, cap)
  return { k, x: (pane.w - diagram.w * k) / 2, y: (pane.h - diagram.h * k) / 2 }
}

/** Zooms to `k`, keeping the diagram point at (px, py) in the pane where it is. */
export function zoomAt(v: View, k: number, px: number, py: number): View {
  k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
  return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
}

export const panBy = (v: View, dx: number, dy: number): View => ({ k: v.k, x: v.x + dx, y: v.y + dy })

/**
 * Where a pan may take the diagram along one axis, from `at`: anywhere if it's bigger than the pane, and
 * otherwise only between where it is and the nearest place it's fully in view. So a pan can bring a diagram
 * that's partly out of view back in, but never pushes one out, and leaves one that's in view where it is.
 */
function reach(at: number, size: number, room: number): [number, number] {
  if (size > room) return [-Infinity, Infinity]
  const inView = Math.min(room - size, Math.max(0, at))
  return [Math.min(at, inView), Math.max(at, inView)]
}

/** Whether a drag, wheel or arrow key would move the diagram at all. */
export function canPan(v: View, pane: Size, diagram: Size) {
  const axis = (at: number, size: number, room: number) => {
    const [lo, hi] = reach(at, size, room)
    return lo < hi
  }
  return axis(v.x, diagram.w * v.k, pane.w) || axis(v.y, diagram.h * v.k, pane.h)
}

/** Pans as a drag, wheel or arrow key does, as far as `reach` lets it. */
export function pan(v: View, dx: number, dy: number, pane: Size, diagram: Size): View {
  const axis = (at: number, d: number, size: number, room: number) => {
    const [lo, hi] = reach(at, size, room)
    return Math.min(hi, Math.max(lo, at + d))
  }
  return { k: v.k, x: axis(v.x, dx, diagram.w * v.k, pane.w), y: axis(v.y, dy, diagram.h * v.k, pane.h) }
}

/** Keeps the diagram within reach: at least KEEP pixels of it (all of it, if it's smaller) stay in the pane. */
export function clamp(v: View, pane: Size, diagram: Size): View {
  const axis = (at: number, size: number, room: number) => {
    const keep = Math.min(KEEP, size)
    return Math.min(room - keep, Math.max(keep - size, at))
  }
  return { k: v.k, x: axis(v.x, diagram.w * v.k, pane.w), y: axis(v.y, diagram.h * v.k, pane.h) }
}

/** Keeps the diagram point at the pane's centre there as the pane changes size. */
export const holdCentre = (v: View, from: Size, to: Size) => panBy(v, (to.w - from.w) / 2, (to.h - from.h) / 2)
