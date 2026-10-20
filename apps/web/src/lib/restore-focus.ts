import { useRef } from "react"

/**
 * For a Radix dialog opened from app state rather than its own trigger: on close, focus goes
 * back to whatever had it when the dialog opened (Radix would otherwise drop it on <body>).
 */
export function useRestoreFocus() {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    },
    onCloseAutoFocus: (e: Event) => {
      // Leave focus alone if it has already moved somewhere else, e.g. into another popover.
      if (!opener.current?.isConnected || document.activeElement !== document.body) return
      e.preventDefault()
      opener.current.focus()
    },
  }
}
