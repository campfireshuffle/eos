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

/** In-page confirmation for destructive actions, including ones an agent requests. */
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
          <AlertDialogTitle>Confirm action</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => answer(true)}>
            {confirm?.action ?? "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
