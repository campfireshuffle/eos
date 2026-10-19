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
    () => matchMedia(MOBILE_QUERY).matches,
  )
}

/** The desktop sidebar panel, so any toggle button can collapse or expand it. */
export const sidebarPanel: { current: PanelImperativeHandle | null } = { current: null }

export function toggleSidebar() {
  if (matchMedia(MOBILE_QUERY).matches) {
    setUi({ mobileNavOpen: !getUi().mobileNavOpen })
    return
  }
  const panel = sidebarPanel.current
  if (!panel) return
  // Animate only this toggle (see app.css); dragging the divider stays instant.
  const group = document.querySelector<HTMLElement>("[data-slot=resizable-panel-group]")
  group?.setAttribute("data-animating", "")
  clearTimeout(animationEnd)
  animationEnd = setTimeout(() => group?.removeAttribute("data-animating"), SIDEBAR_ANIMATION_MS + 50)
  if (panel.isCollapsed()) panel.expand()
  else panel.collapse()
}

export const SIDEBAR_ANIMATION_MS = 220
let animationEnd: ReturnType<typeof setTimeout> | undefined
