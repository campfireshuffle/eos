import { useState } from "react"

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

import { useRestoreFocus } from "@/lib/restore-focus"
import { setUi, useUi } from "@/lib/ui-state"

/** In-page confirmation for destructive actions, including ones an agent requests, and alerts. */
export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm)
  // Keeps showing the last dialog's text while it animates closed.
  const [shown, setShown] = useState(confirm)
  if (confirm && confirm !== shown) setShown(confirm)
  const restoreFocus = useRestoreFocus()
  const answer = (ok: boolean) => {
    confirm?.resolve(ok)
    setUi({ confirm: null })
  }
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent {...restoreFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown?.title}</AlertDialogTitle>
          <AlertDialogDescription className="[overflow-wrap:anywhere]">{shown?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>{shown?.action ? "Cancel" : "OK"}</AlertDialogCancel>
          {shown?.action && (
            <AlertDialogAction variant="destructive" onClick={() => answer(true)}>
              {shown.action}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
