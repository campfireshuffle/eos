import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { useDefaultLayout } from "react-resizable-panels"

import { decodeShare } from "@eos/core"
import { ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { Dialog } from "@workspace/ui/components/dialog"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { ResizeHandle } from "@/components/resize-handle"
import { Home } from "@/components/home"
import { CurrentPage, EmptyPage } from "@/components/page"
import { SettingsDialog } from "@/components/settings-dialog"
import { Sidebar } from "@/components/sidebar"
import { useDiagram, useEos, useSettings } from "@/lib/eos"
import { useHistoryEntry } from "@/lib/history"
import { isAnimating, sidebarPanel, useIsMobile } from "@/lib/layout"
import { diagramHref, homeHref, navigate, pageName, parseRoute, type Route } from "@/lib/router"
import { applyTheme } from "@/lib/theme"
import { getUi, setUi, useUi } from "@/lib/ui-state"

// The editor (CodeMirror, the preview and its gestures) is a separate download, so the
// library opens without it. It's fetched in the background once the app is idle.
let editorModule: typeof import("@/components/editor") | undefined
const loadEditor = () => import("@/components/editor").then((m) => (editorModule = m))
const LazyEditor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })))

export function App() {
  const { entry, hash } = useHistoryEntry()
  const route = parseRoute(hash)
  const settings = useSettings()
  useEffect(() => applyTheme(settings.theme), [settings.theme])
  useShareImport(route.name === "import" ? route.data : null)
  // On phones the library scrolls the page; the editor fills the screen, so start it at the top.
  const editorId = route.name === "diagram" ? route.id : null
  useEffect(() => {
    if (editorId) window.scrollTo({ top: 0 })
  }, [editorId])
  // Leaving a diagram ends its preview. This follows the route, not the editor's mounting; and a
  // preview an agent opens along with another diagram belongs to that one, so it stays.
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
        <NamedPage route={route} entry={entry}>
          {route.name === "home" && <Home route={route} entry={entry} />}
          {route.name === "diagram" && (
            <Suspense fallback={<EmptyPage />}>
              <EditorRoute key={route.id} id={route.id} />
            </Suspense>
          )}
        </NamedPage>
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

/**
 * The page's name, from its route (pageName), for its heading and the tab's title. Its own component, so a diagram's
 * every edit renders the heading again, not the whole app.
 */
function NamedPage({ route, entry, children }: { route: Route; entry: string; children: ReactNode }) {
  const diagram = useDiagram(route.name === "diagram" ? route.id : "")
  const name = pageName(route, diagram === null ? null : diagram?.meta.title)
  useEffect(() => {
    document.title = name ? `${name} · Eos` : "Eos"
  }, [name])
  return <CurrentPage value={{ entry, name }}>{children}</CurrentPage>
}

function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const mobile = useIsMobile()
  const mobileNavOpen = useUi((s) => s.mobileNavOpen)
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const layout = useDefaultLayout({ id: "eos-shell", storage: localStorage })
  const sidebar = <RouteSidebar route={route} />

  // Any navigation closes the mobile drawer, even to the page already shown. It closes as the navigation starts, so
  // it has handed focus back to its opener, and made the page live again, before the page arrives and takes focus.
  useEffect(() => {
    const close = () => getUi().mobileNavOpen && flushSync(() => setUi({ mobileNavOpen: false }))
    navigation.addEventListener("navigate", close)
    return () => navigation.removeEventListener("navigate", close)
  }, [])

  // One tree for phones and desktop, with the page in the same place in both: crossing 768px (rotating a phone) only
  // changes the chrome around it, so the page keeps its state (the editor its caret, scroll and focus; the library its
  // selection). On phones the group is just the content panel, unclipped (see .eos-phone-shell in app.css).
  return (
    <>
      <div
        data-collapsed={mobile ? undefined : collapsed}
        className={cn(mobile ? "eos-phone-shell" : "eos-shell group/shell h-svh pt-2", !mobile && (collapsed ? "pl-0" : "pl-2"))}
      >
        {/* No right/bottom gutter: the content pane runs to the window edges; the top gap stays.
            The left gap belongs to the sidebar, so it goes when the sidebar is collapsed. */}
        <ResizablePanelGroup orientation="horizontal" {...(mobile ? {} : layout)}>
          {!mobile && (
            <>
              <ResizablePanel
                id="sidebar"
                // Hidden, it takes no focus and screen readers skip it. On the panel rather than its contents, or the
                // panel's own scroller, left with nothing focusable inside, becomes an invisible Tab stop.
                inert={collapsed}
                panelRef={sidebarPanel}
                defaultSize="240px"
                minSize="180px"
                maxSize="420px"
                collapsible
                collapsedSize="0px"
                onResize={(size) => {
                  // During a toggle animation the button has already set the end state; ignore the in-between sizes.
                  if (!isAnimating("sidebar")) setUi({ sidebarCollapsed: size.inPixels < 1 })
                }}
              >
                {/* Keeps its width while the panel animates, so it slides out of view instead of re-wrapping. */}
                <div className="h-full w-full min-w-[180px] overflow-hidden">{sidebar}</div>
              </ResizablePanel>
              {/* Collapsed: no gutter, just an invisible 8px strip to drag the sidebar back open.
                  Its pill sits at the window's edge, above the content, so it shows on hover and keyboard focus. The strip
                  takes no pointer events, so wheels and clicks there still reach the content; drags are found by position. */}
              <ResizeHandle
                className={cn(
                  "transition-[width] duration-200",
                  collapsed &&
                    "z-10 justify-start before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-2 before:content-[''] aria-[orientation=vertical]:w-0"
                )}
              />
            </>
          )}
          {/* On phones the page itself scrolls (so Safari can collapse its toolbar); the editor pins itself to the viewport. */}
          <ResizablePanel
            id="content"
            minSize={mobile ? undefined : "360px"}
            className={mobile ? "flex min-h-svh flex-col" : "flex min-w-0"}
          >
            {children}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {mobile && (
        <Dialog
          open={mobileNavOpen}
          onClose={() => setUi({ mobileNavOpen: false })}
          closeOnBackdrop
          aria-label="Navigation"
          className="m-0 h-full max-h-none w-72 max-w-[85vw] border-r bg-background shadow-lg not-open:-translate-x-10 open:flex open:flex-col starting:open:-translate-x-10"
        >
          {sidebar}
        </Dialog>
      )}
    </>
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
