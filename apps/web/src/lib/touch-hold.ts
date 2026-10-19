/**
 * Tracks a touch press-and-hold on the tag tree, which starts a tag drag. While
 * it lasts (and briefly after) taps shouldn't navigate or dismiss the mobile drawer.
 */
const HOLD_MS = 350
const GRACE_MS = 600

let holding = false
let graceUntil = 0
let timer: ReturnType<typeof setTimeout> | null = null

export function touchHoldStart() {
  touchHoldCancel()
  timer = setTimeout(() => (holding = true), HOLD_MS)
}

/** The finger moved before the hold began: it's a scroll, not a drag. */
export function touchHoldCancel() {
  if (timer) clearTimeout(timer)
  timer = null
}

export function touchHoldEnd() {
  touchHoldCancel()
  if (holding) graceUntil = Date.now() + GRACE_MS
  holding = false
}

export function isTouchHolding(): boolean {
  return holding || Date.now() < graceUntil
}
