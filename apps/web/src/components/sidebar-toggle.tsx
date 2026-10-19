import { PanelLeft } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { toggleSidebar, useIsMobile } from "@/lib/layout"
import { useUi } from "@/lib/ui-state"

/** Shown in the content header when the sidebar is hidden (collapsed on desktop, always on mobile). */
export function SidebarToggle() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const mobile = useIsMobile()
  if (!mobile && !collapsed) return null
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Show sidebar" onClick={toggleSidebar} className="text-muted-foreground">
      <PanelLeft />
    </Button>
  )
}
