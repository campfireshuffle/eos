import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

import { answerConfirm, getUi, useUi } from "@/lib/ui-state"

/**
 * In-page confirmation for destructive actions, including ones an agent requests, and alerts. It shows `ui.confirm`,
 * which stays (closed) while it fades out; ui-state records where focus goes back to (see the invariant there).
 */
export function ConfirmDialog() {
  const c = useUi((s) => s.confirm)
  return (
    <AlertDialog open={!!c?.open} onOpenChange={(open) => !open && answerConfirm(false)}>
      <AlertDialogContent
        // Each confirm mounts afresh, so focus starts on Cancel even if it opened while the last one faded out.
        key={c?.id}
        onCloseAutoFocus={(e) => {
          // Focus is ours to place, never Radix's: back to this confirm's opener if focus was dropped, else left
          // alone. A confirm replaced mid-fade closes after its replacement has opened, so it does nothing.
          e.preventDefault()
          if (!getUi().confirm?.open && document.activeElement === document.body && c?.opener?.isConnected) c.opener.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{c?.title}</AlertDialogTitle>
          <AlertDialogDescription className="[overflow-wrap:anywhere]">{c?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answerConfirm(false)}>{c?.action ? "Cancel" : "OK"}</AlertDialogCancel>
          {c?.action && (
            <AlertDialogAction variant="destructive" onClick={() => answerConfirm(true)}>
              {c.action}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
