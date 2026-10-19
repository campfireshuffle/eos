import { cn } from "@workspace/ui/lib/utils"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

// The drag handle is apps/web's ResizeHandle, styled for Eos.
export { ResizablePanel, ResizablePanelGroup }
