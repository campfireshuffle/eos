import { useSyncExternalStore } from "react"
import type { PanelImperativeHandle } from "react-resizable-panels"

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

/** The desktop sidebar panel, so any toggle button can collapse or expand it. */
export const sidebarPanel: { current: PanelImperativeHandle | null } = { current: null }

/** Whether the sidebar shows: the drawer on phones, the panel on desktop. */
export function isSidebarOpen(): boolean {
  return matchMedia(MOBILE_QUERY).matches ? getUi().mobileNavOpen : !getUi().sidebarCollapsed
}

export function toggleSidebar() {
  setSidebarOpen(!isSidebarOpen())
}

export function setSidebarOpen(open: boolean) {
  if (matchMedia(MOBILE_QUERY).matches) {
    setUi({ mobileNavOpen: open })
    return
  }
  const panel = sidebarPanel.current
  if (!panel || panel.isCollapsed() !== open) return
  // Animate only this toggle (see app.css); dragging the divider stays instant.
  const shell = document.querySelector<HTMLElement>(".eos-shell")
  const group = shell?.querySelector("[data-slot=resizable-panel-group]")
  group?.setAttribute("data-animating", "")
  const toggle = ++toggles
  // Flip the state first: the shell's padding, gutter and corner animate off it in the same motion.
  // (onResize alone would only report "collapsed" once the panel reaches zero, a second stage.)
  setUi({ sidebarCollapsed: !open })
  if (open) panel.expand()
  else panel.collapse()
  // A frame later React has rendered the new sizes and their transitions have started. Transitions
  // only: an infinite animation inside (the editor's caret blink) never finishes. Only the latest
  // toggle ends the animation, so a second one mid-motion isn't cut short by the first.
  requestAnimationFrame(async () => {
    const transitions = shell?.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition) ?? []
    await Promise.allSettled(transitions.map((a) => a.finished))
    if (toggle === toggles) group?.removeAttribute("data-animating")
  })
}

let toggles = 0
