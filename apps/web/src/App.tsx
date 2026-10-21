import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"

import { decodeShare } from "@eos/core"
import { ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { Sheet, SheetContent, SheetTitle } from "@workspace/ui/components/sheet"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { ResizeHandle } from "@/components/resize-handle"
import { Home } from "@/components/home"
import { EmptyPage } from "@/components/page"
import { SettingsDialog } from "@/components/settings-dialog"
import { Sidebar } from "@/components/sidebar"
import { useDiagram, useEos, useSettings } from "@/lib/eos"
import { sidebarPanel, useIsMobile } from "@/lib/layout"
import { diagramHref, homeHref, navigate, useRoute, type Route } from "@/lib/router"
import { applyTheme } from "@/lib/theme"
import { getUi, setUi, useUi } from "@/lib/ui-state"

// The editor (CodeMirror, the preview and its gestures) is a separate download, so the
// library opens without it. It's fetched in the background once the app is idle.
let editorModule: typeof import("@/components/editor") | undefined
const loadEditor = () => import("@/components/editor").then((m) => (editorModule = m))
const LazyEditor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })))

export function App() {
  const route = useRoute()
  const settings = useSettings()
  useEffect(() => applyTheme(settings.theme), [settings.theme])
  useShareImport(route.name === "import" ? route.data : null)
  // On phones the library scrolls the page; the editor fills the screen, so start it at the top.
  const editorId = route.name === "diagram" ? route.id : null
  useEffect(() => {
    if (editorId) window.scrollTo({ top: 0 })
  }, [editorId])
  // Leaving a diagram ends its preview. This follows the route, not the editor, which remounts
  // when a rotated phone crosses into the side-by-side layout; and a preview an agent opens
  // along with another diagram belongs to that one, so it stays.
  useEffect(() => {
    const preview = getUi().preview
    if (preview && preview.id !== editorId) setUi({ preview: null })
  }, [editorId])
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500))
    idle(() => void loadEditor())
  }, [])

  return (
    <TooltipProvider delayDuration={400}>
      <Shell route={route}>
        {route.name === "home" && <Home route={route} />}
        {route.name === "diagram" && (
          <Suspense fallback={<EmptyPage />}>
            <EditorRoute key={route.id} id={route.id} />
          </Suspense>
        )}
      </Shell>
      <SettingsDialog />
      <ConfirmDialog />
    </TooltipProvider>
  )
}

/**
 * The editor itself once the idle preload has it. A lazy component suspends on its first
 * render even when its module is ready, and React then keeps the fallback up for 300ms.
 */
function EditorRoute({ id }: { id: string }) {
  // Chosen once per diagram, so a preload landing while it's open doesn't remount the editor.
  const [Editor] = useState(() => editorModule?.Editor ?? LazyEditor)
  return <Editor id={id} />
}

function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const mobile = useIsMobile()
  const mobileNavOpen = useUi((s) => s.mobileNavOpen)
  const collapsed = useUi((s) => s.sidebarCollapsed)
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
    // The left gap belongs to the sidebar, so it goes when the sidebar is collapsed.
    <div data-collapsed={collapsed} className={cn("eos-shell group/shell h-svh pt-2", collapsed ? "pl-0" : "pl-2")}>
      <ResizablePanelGroup orientation="horizontal" {...layout}>
        <ResizablePanel
          id="sidebar"
          panelRef={sidebarPanel}
          defaultSize="240px"
          minSize="180px"
          maxSize="420px"
          collapsible
          collapsedSize="0px"
          onResize={(size) => {
            // During a toggle animation the button has already set the end state; ignore the in-between sizes.
            if (!document.querySelector("[data-animating]")) setUi({ sidebarCollapsed: size.inPixels < 1 })
          }}
        >
          {/* Keeps its width while the panel animates, so it slides out of view instead of re-wrapping.
              Inert while hidden, so its controls take no focus and screen readers skip them. */}
          <div inert={collapsed} className="h-full w-full min-w-[180px] overflow-hidden">
            {sidebar}
          </div>
        </ResizablePanel>
        {/* Collapsed: no gutter, just an invisible 8px strip to drag the sidebar back open. */}
        <ResizeHandle
          className={cn(
            "transition-[width] duration-200",
            collapsed && "before:absolute before:inset-y-0 before:left-0 before:w-2 before:content-[''] aria-[orientation=vertical]:w-0"
          )}
        />
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
