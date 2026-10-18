import { useEffect } from "react"

import { decodeShare } from "@eos/core"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Editor } from "@/components/editor"
import { Home } from "@/components/home"
import { SettingsDialog } from "@/components/settings-dialog"
import { Sidebar } from "@/components/sidebar"
import { useDiagram, useEos, useSettings } from "@/lib/eos"
import { diagramHref, homeHref, navigate, useRoute } from "@/lib/router"
import { applyThemeCss } from "@/lib/theme"

export function App() {
  const route = useRoute()
  const settings = useSettings()
  useEffect(() => applyThemeCss(settings.theme.customCss), [settings.theme.customCss])
  useShareImport(route.name === "import" ? route.data : null)

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-svh gap-2 p-2">
        {route.name === "diagram" ? <EditorRoute id={route.id} /> : <Sidebar route={route} />}
        {route.name === "home" && <Home route={route} />}
      </div>
      <SettingsDialog />
      <ConfirmDialog />
    </TooltipProvider>
  )
}

function EditorRoute({ id }: { id: string }) {
  const route = useRoute()
  const diagram = useDiagram(id)
  return (
    <>
      <Sidebar route={route} activeTag={diagram?.meta.tags[0] ?? null} />
      <Editor id={id} />
    </>
  )
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
