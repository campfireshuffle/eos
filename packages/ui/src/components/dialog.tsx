"use client"

import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

/** The modal dialog a popover, menu or tooltip portals into: a modal makes everything outside it inert. */
const PortalContainer = React.createContext<HTMLElement | undefined>(undefined)

export const usePortalContainer = () => React.useContext(PortalContainer)

/** React Aria's live announcer, which it puts in <body>, lives in the top open modal, so its announcements aren't inert. */
function adoptAnnouncer() {
  const announcer = document.querySelector("[data-live-announcer]")
  const top = [...document.querySelectorAll("dialog:modal")].at(-1) ?? document.body
  if (announcer && announcer.parentNode !== top) top.prepend(announcer)
}

/**
 * A native modal <dialog>, shown with showModal() while `open`. The browser makes the rest of the page inert, closes it on Escape,
 * and returns focus to what had it when it opened; `onClose` hears every close. A closed dialog never keeps focus.
 * With `closeOnBackdrop`, a click that starts and ends on the backdrop closes it.
 */
function Dialog({
  open,
  onClose,
  closeOnBackdrop,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"dialog">, "open"> & { open: boolean; closeOnBackdrop?: boolean }) {
  const [dialog, setDialog] = React.useState<HTMLDialogElement | null>(null)
  const pressed = React.useRef<EventTarget>(null)
  // The contents mount as it opens, and stay until it has closed and faded out, or for as long as it's open again.
  const [mounted, setMounted] = React.useState(open)
  if (open && !mounted) setMounted(true)
  React.useLayoutEffect(() => {
    if (open !== dialog?.open) dialog?.[open ? "showModal" : "close"]()
    adoptAnnouncer()
    if (!open || !dialog) return
    // React Aria makes the announcer on its first announcement, which can come while this is open.
    const observer = new MutationObserver(adoptAnnouncer)
    observer.observe(document.body, { childList: true })
    return () => {
      observer.disconnect()
      // Unmounted while open, it would take the announcer with it.
      const announcer = dialog.querySelector(":scope > [data-live-announcer]")
      if (announcer) document.body.prepend(announcer)
    }
  }, [dialog, open])
  return (
    <dialog
      ref={setDialog}
      data-slot="dialog"
      className={cn(
        "bg-popover text-body text-popover-foreground outline-none backdrop:bg-black/10 supports-backdrop-filter:backdrop:backdrop-blur-xs",
        className
      )}
      onClose={(e) => {
        const d = e.currentTarget
        // The event comes a task after the close, by which time the dialog may have opened again.
        if (d.open) return
        // With no opener to go back to, focus would stay on the closed dialog's last control.
        if (d.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
        void Promise.allSettled(d.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => setMounted(false))
        onClose?.(e)
      }}
      onPointerDown={(e) => (pressed.current = e.target)}
      onClick={(e) => closeOnBackdrop && e.target === e.currentTarget && pressed.current === e.target && e.currentTarget.close()}
      {...props}
    >
      <PortalContainer value={dialog ?? undefined}>{(open || mounted) && children}</PortalContainer>
    </dialog>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="dialog-title" className={cn("font-heading text-title", className)} {...props} />
}

export { Dialog, DialogTitle }
