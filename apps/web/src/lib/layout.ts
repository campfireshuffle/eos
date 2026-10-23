import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react"
import type { PanelImperativeHandle } from "react-resizable-panels"

import { entryId } from "./history"
import { setUi, getUi } from "./ui-state"

const MOBILE_QUERY = "(max-width: 767px)"

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(MOBILE_QUERY)
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => matchMedia(MOBILE_QUERY).matches
  )
}

/**
 * Whether `panel` is collapsed, as the panel itself has it, asked again each time it resizes. Pass `onResize` to the
 * Panel. Until the panel has mounted, it's `before`.
 */
export function usePanelCollapsed(panel: RefObject<PanelImperativeHandle | null>, before: boolean) {
  const resized = useRef(() => {})
  const collapsed = useSyncExternalStore(
    useCallback((changed: () => void) => {
      resized.current = changed
      return () => (resized.current = () => {})
    }, []),
    () => panel.current?.isCollapsed() ?? before
  )
  return { collapsed, onResize: () => resized.current() }
}

/** The desktop sidebar panel, so any toggle button can collapse or expand it. */
export const sidebarPanel: { current: PanelImperativeHandle | null } = { current: null }

/** Whether the sidebar shows: the drawer on phones, the panel on desktop. */
export function isSidebarOpen(): boolean {
  return matchMedia(MOBILE_QUERY).matches ? getUi().drawerOn === entryId() : !getUi().sidebarCollapsed
}

export function toggleSidebar() {
  setSidebarOpen(!isSidebarOpen())
}

export function setSidebarOpen(open: boolean) {
  if (matchMedia(MOBILE_QUERY).matches) {
    setUi({ drawerOn: open ? entryId() : null })
    return
  }
  const panel = sidebarPanel.current
  if (!panel || panel.isCollapsed() !== open) return
  const shell = document.querySelector<HTMLElement>(".eos-shell")
  togglePanel(panel, shell?.querySelector("[data-slot=resizable-panel-group]"), shell, () =>
    // Flip the state first: the shell's padding, gutter and corner animate off it in the same motion.
    // (onResize alone would only report "collapsed" once the panel reaches zero, a second stage.)
    setUi({ sidebarCollapsed: !open })
  )
}

/**
 * Collapses `panel` if it's expanded, and expands it if it's collapsed, animating only this toggle (see app.css):
 * dragging the divider, a saved layout and a new orientation stay instant. `group` is the panel's group element, and
 * `scope` holds everything that moves with it. `before` runs first, for anything that animates along.
 */
export function togglePanel(
  panel: PanelImperativeHandle,
  group: Element | null | undefined,
  scope: Element | null | undefined,
  before = () => {}
) {
  group?.setAttribute("data-animating", "")
  const toggle = (toggles.get(group ?? panel) ?? 0) + 1
  toggles.set(group ?? panel, toggle)
  const open = panel.isCollapsed()
  before()
  if (open) panel.expand()
  else panel.collapse()
  // A frame later React has rendered the new sizes and their transitions have started. Transitions
  // only: an infinite animation inside (the editor's caret blink) never finishes. Only the latest
  // toggle ends the animation, so a second one mid-motion isn't cut short by the first.
  requestAnimationFrame(async () => {
    const transitions = scope?.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition) ?? []
    await Promise.allSettled(transitions.map((a) => a.finished))
    if (toggles.get(group ?? panel) === toggle) group?.removeAttribute("data-animating")
  })
}

/** Each group's latest toggle, so the sidebar's and the editor's don't end each other's. */
const toggles = new WeakMap<object, number>()

/** Whether the group holding the panel with this id is in a toggle's animation; each group is asked about on its own. */
export function isAnimating(panelId: string): boolean {
  return !!document.getElementById(panelId)?.parentElement?.hasAttribute("data-animating")
}

// Crossing 768px lays panels out anew, instantly: a toggle's animation still running there ends with the layout it was in.
// Registered before any component's listener, so it runs before the new layout renders.
matchMedia(MOBILE_QUERY).addEventListener("change", () => {
  for (const group of document.querySelectorAll("[data-animating]")) group.removeAttribute("data-animating")
})
