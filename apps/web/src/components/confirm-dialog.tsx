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
  // Keeps showing the last dialog's text while it animates closed. Each new confirm gets a new key, so its content
  // mounts afresh and focus starts on Cancel: if one opened during the fade, the Delete just clicked would keep focus.
  const [{ shown, n }, setShown] = useState({ shown: confirm, n: 0 })
  if (confirm && confirm !== shown) setShown({ shown: confirm, n: n + 1 })
  const restoreFocus = useRestoreFocus()
  const answer = (ok: boolean) => {
    confirm?.resolve(ok)
    setUi({ confirm: null })
  }
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent
        key={n}
        {...restoreFocus}
        // A dialog replacing one mid-fade opens with focus on <body> (the old buttons are gone), so it keeps the
        // last dialog's opener to return focus to.
        onOpenAutoFocus={() => {
          if (document.activeElement !== document.body) restoreFocus.onOpenAutoFocus()
        }}
      >
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
