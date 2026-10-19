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

import { setUi, useUi } from "@/lib/ui-state"

/** In-page confirmation for destructive actions, including ones an agent requests, and alerts. */
export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm)
  const answer = (ok: boolean) => {
    confirm?.resolve(ok)
    setUi({ confirm: null })
  }
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>{confirm?.action ? "Cancel" : "OK"}</AlertDialogCancel>
          {confirm?.action && (
            <AlertDialogAction variant="destructive" onClick={() => answer(true)}>
              {confirm.action}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
