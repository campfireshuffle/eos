import { useEffect, type ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"

import { decodeShare } from "@eos/core"
import { ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { Sheet, SheetContent, SheetTitle } from "@workspace/ui/components/sheet"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { ResizeHandle } from "@/components/resize-handle"
import { Editor } from "@/components/editor"
import { Home } from "@/components/home"
import { SettingsDialog } from "@/components/settings-dialog"
import { Sidebar } from "@/components/sidebar"
import { useDiagram, useEos, useSettings } from "@/lib/eos"
import { sidebarPanel, useIsMobile } from "@/lib/layout"
import { diagramHref, homeHref, navigate, useRoute, type Route } from "@/lib/router"
import { applyTheme } from "@/lib/theme"
import { setUi, useUi } from "@/lib/ui-state"

export function App() {
  const route = useRoute()
  const settings = useSettings()
  useEffect(() => applyTheme(settings.theme), [settings.theme])
  useShareImport(route.name === "import" ? route.data : null)

  return (
    <TooltipProvider delayDuration={400}>
      <Shell route={route}>
        {route.name === "home" && <Home route={route} />}
        {route.name === "diagram" && <Editor key={route.id} id={route.id} />}
      </Shell>
      <SettingsDialog />
      <ConfirmDialog />
    </TooltipProvider>
  )
}

function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const mobile = useIsMobile()
  const mobileNavOpen = useUi((s) => s.mobileNavOpen)
  const layout = useDefaultLayout({ id: "eos-shell", storage: localStorage })
  const sidebar = <RouteSidebar route={route} />

  // Close the mobile drawer whenever the route changes.
  const hash = location.hash
  useEffect(() => setUi({ mobileNavOpen: false }), [hash])

  if (mobile) {
    return (
      <>
        {/* On phones the page itself scrolls (so Safari can collapse its toolbar); the editor pins itself to the viewport. */}
        <div className="flex min-h-svh flex-col">{children}</div>
        <Sheet open={mobileNavOpen} onOpenChange={(open) => setUi({ mobileNavOpen: open })}>
          <SheetContent side="left" showCloseButton={false} className="w-72 max-w-[85vw] bg-background p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    // No right/bottom gutter: the content pane runs to the window edges; the top gap stays.
    <div className="h-svh pt-2 pl-2">
      <ResizablePanelGroup orientation="horizontal" {...layout}>
        <ResizablePanel
          id="sidebar"
          panelRef={sidebarPanel}
          defaultSize="240px"
          minSize="180px"
          maxSize="420px"
          collapsible
          collapsedSize="0px"
          onResize={(size) => setUi({ sidebarCollapsed: size.inPixels < 1 })}
        >
          {sidebar}
        </ResizablePanel>
        <ResizeHandle />
        <ResizablePanel id="content" minSize="360px" className="flex min-w-0">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function RouteSidebar({ route }: { route: Route }) {
  const diagram = useDiagram(route.name === "diagram" ? route.id : "")
  return <Sidebar route={route} activeTag={route.name === "diagram" ? (diagram?.meta.tags[0] ?? null) : null} />
}

function useShareImport(data: string | null) {
  const eos = useEos()
  useEffect(() => {
    if (data === null) return
    let cancelled = false
    void decodeShare(data).then(async (payload) => {
      if (cancelled) return
      if (!payload) return navigate(homeHref(), { replace: true })
      const id = await eos.importShare(payload)
      navigate(diagramHref(id), { replace: true })
    })
    return () => {
      cancelled = true
    }
  }, [data, eos])
}
