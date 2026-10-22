import { useId } from "react"

import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogTitle } from "@workspace/ui/components/dialog"

import { answerConfirm, useUi } from "@/lib/ui-state"

/**
 * In-page confirmation for destructive actions, including ones an agent requests, and alerts. It shows `ui.confirm`,
 * which stays (closed) while it fades out. Focus starts on Cancel, the first button, each time one opens.
 */
export function ConfirmDialog() {
  const c = useUi((s) => s.confirm)
  const id = useId()
  return (
    <Dialog
      open={!!c?.open}
      onClose={() => answerConfirm(false)}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-message`}
      className="m-auto w-full max-w-xs gap-4 rounded-xl p-4 ring-1 ring-foreground/10 open:grid sm:max-w-sm"
    >
      <div className="grid gap-1.5 text-center sm:text-left">
        <DialogTitle id={`${id}-title`}>{c?.title}</DialogTitle>
        <p id={`${id}-message`} className="text-balance [overflow-wrap:anywhere] text-muted-foreground md:text-pretty">
          {c?.message}
        </p>
      </div>
      <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => answerConfirm(false)}>
          {c?.action ? "Cancel" : "OK"}
        </Button>
        {c?.action && (
          <Button variant="destructive" onClick={() => answerConfirm(true)}>
            {c.action}
          </Button>
        )}
      </div>
    </Dialog>
  )
}
