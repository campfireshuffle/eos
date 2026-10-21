import {
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  Redo2,
  Star,
  TriangleAlert,
  Undo2,
  History as HistoryIcon,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { validate, type SourceBinding } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useDefaultLayout } from "react-resizable-panels"

import { useDiagram, useEos } from "@/lib/eos"
import { useCopy } from "@/lib/use-copy"
import { useIsMobile } from "@/lib/layout"
import { homeHref } from "@/lib/router"
import { getUi, requestZoom, setUi, useUi } from "@/lib/ui-state"

import { CodeEditor, type CodeEditorHandle } from "./code-editor"
import { formatWhen, HistoryMenu } from "./history-menu"
import { ExportMenu, useExportActions } from "./export-menu"
import { Preview } from "./preview"
import { ResizeHandle } from "./resize-handle"
import { EmptyPage, Page, PageHeader, Panel, PanelHeader } from "./page"

export function Editor({ id }: { id: string }) {
  const [copied, copy] = useCopy()
  const eos = useEos()
  const diagram = useDiagram(id)
  const [source, setSource] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)

  // The editor syncs with Loro edit by edit. Bind whenever there's no live binding and the
  // diagram exists: on open, and again after a backup replaces it.
  // `key` counts bindings, so each new one remounts the editor.
  const [{ binding, key }, setBound] = useState<{ binding: SourceBinding | null; key: number }>({ binding: null, key: 0 })
  useEffect(() => {
    // Retried on each update to the diagram, which covers it reappearing after a backup import.
    if (binding || !diagram) return
    let alive = true
    eos.bindSource(id).then(
      (b) => alive && setBound((prev) => ({ binding: b, key: prev.key + 1 })),
      () => {} // Not there (yet): bind when it reappears.
    )
    return () => {
      alive = false
    }
  }, [eos, id, binding, diagram])
  // `source` follows the binding for the preview, checks and export, even while a past
  // version is shown and the live editor is hidden.
  useEffect(() => {
    if (!binding) return
    setSource(binding.text())
    const offChange = binding.onChange(() => setSource(binding.text()))
    const offClose = binding.onClose(() => setBound((prev) => ({ ...prev, binding: null })))
    return () => {
      offChange()
      offClose()
    }
  }, [binding])

  // Undo/redo only appear once this tab has something to undo or redo. Checked on every
  // change to `source`, which follows the binding's edits, local and remote, as they land,
  // and on every new binding, whose stacks start empty even when its text is the same.
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  useEffect(() => {
    let alive = true
    eos.canUndo(id).then(
      (h) => alive && setHistory(h),
      () => {}
    )
    return () => {
      alive = false
    }
  }, [eos, id, binding, source])

  // Previewing a past version shows its source read-only in both panes.
  const preview = useUi((s) => s.preview)
  const previewing = preview?.id === id ? preview : null
  const [previewSource, setPreviewSource] = useState<string | null>(null)
  useEffect(() => {
    if (!previewing) return setPreviewSource(null)
    let alive = true
    eos.getSource(id, previewing.version).then(
      (s) => alive && setPreviewSource(s),
      () => {}
    )
    return () => {
      alive = false
    }
  }, [eos, id, previewing])
  // Leaving this diagram ends its preview (but not one just opened for another diagram).
  useEffect(() => () => void (getUi().preview?.id === id && setUi({ preview: null })), [id])
  const shown = previewing ? previewSource : source

  const result = useMemo(() => (shown === null ? null : validate(shown)), [shown])
  const lastValid = useRef<string>("")
  // A past version being previewed isn't the latest one, so it never stands in for it.
  if (result?.ok && shown !== null && !previewing) lastValid.current = shown

  const errorLine = result && !result.ok ? result.error.line || null : null
  const status = !result
    ? ""
    : result.ok
      ? "Valid"
      : `${result.error.line > 0 ? `Line ${result.error.line}, column ${result.error.column}: ` : ""}${result.error.message}`
  // Read out once typing pauses, not on every keystroke; the footer itself keeps up as you type.
  const [announced, setAnnounced] = useState(status)
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(status), 1000)
    return () => clearTimeout(t)
  }, [status])
  const undo = () => void eos.undo(id).catch(() => {})
  const redo = () => void eos.redo(id).catch(() => {})

  const title = diagram?.meta.title ?? ""
  // Exports are of the version shown, like the preview they're drawn from. Until a past
  // version's text arrives, the preview still shows the latest, and so do they.
  const actions = useExportActions(title, shown ?? source ?? "", () => svgRef.current)

  useShortcuts(actions)
  const mobile = useIsMobile()
  const orientation = mobile ? "vertical" : "horizontal"
  const layout = useDefaultLayout({
    id: `eos-editor-${orientation}`,
    storage: localStorage,
  })

  if (diagram === null) {
    return (
      <EmptyPage>
        This diagram doesn’t exist.
        <Button variant="outline" asChild>
          <a href={homeHref()}>Back to diagrams</a>
        </Button>
      </EmptyPage>
    )
  }
  if (!diagram || source === null) return <EmptyPage />

  return (
    <Page className="max-md:h-svh">
      <PageHeader
        // Also committed on leaving, when the diagram may already be gone.
        title={<TitleInput value={title} onCommit={(t) => void eos.renameDiagram(id, t).catch(() => {})} />}
      >
        <IconButton label={diagram.starred ? "Unstar" : "Star"} onClick={() => eos.setStarred(id, !diagram.starred)}>
          <Star className={diagram.starred ? "fill-[var(--eos-champagne)] text-[var(--eos-champagne)]" : ""} />
        </IconButton>
      </PageHeader>

      {previewing && (
        <Banner>
          <HistoryIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 grow basis-48 truncate">
            Viewing the version from {formatWhen(previewing.at)} · {previewing.label}
          </span>
          <Button
            size="xs"
            className="text-label"
            onClick={async () => {
              await eos.restoreVersion(id, previewing.version)
              setUi({ preview: null })
            }}
          >
            Restore this version
          </Button>
          <Button size="xs" variant="ghost" className="text-label" onClick={() => setUi({ preview: null })}>
            Back to latest
          </Button>
        </Banner>
      )}
      {!previewing && diagram.deletedAt && (
        <Banner>
          <Trash2 className="size-4 text-muted-foreground" />
          <span className="flex-1">This diagram is deleted.</span>
          <Button size="xs" className="text-label" onClick={() => eos.restoreDiagram(id)}>
            <RotateCcw /> Restore
          </Button>
        </Banner>
      )}
      <ResizablePanelGroup key={orientation} orientation={orientation} className="min-h-0 flex-1" {...layout}>
        <ResizablePanel id="source" defaultSize="42%" minSize={mobile ? "120px" : "280px"} className="flex">
          <Panel as="section" split="start" className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <PanelHeader title="Source">
              {(history.canUndo || history.canRedo) && (
                <>
                  <IconButton label="Undo" shortcut="⌘Z" onClick={undo} disabled={!history.canUndo}>
                    <Undo2 />
                  </IconButton>
                  <IconButton label="Redo" shortcut="⇧⌘Z" onClick={redo} disabled={!history.canRedo}>
                    <Redo2 />
                  </IconButton>
                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}
              <HistoryMenu id={id} />
              <IconButton label={copied ? "Copied" : "Copy source"} onClick={() => copy(shown ?? "")}>
                {copied ? <Check className="text-[var(--eos-green)]" /> : <Copy />}
              </IconButton>
            </PanelHeader>
            {previewing ? (
              <CodeEditor
                key={`preview:${previewing.version}`}
                value={previewSource ?? ""}
                readOnly
                errorAt={errorLine}
                handleRef={editorRef}
              />
            ) : binding ? (
              <CodeEditor
                key={key}
                binding={binding}
                onChange={setSource}
                onUndo={undo}
                onRedo={redo}
                errorAt={errorLine}
                handleRef={editorRef}
              />
            ) : (
              <div className="min-h-0 flex-1" />
            )}
            <p role="status" className="sr-only">
              {announced}
            </p>
            {result?.ok ? (
              <footer className="flex items-center gap-1.5 px-4 py-2.5 text-caption text-muted-foreground">
                <CircleCheck className="size-3.5 text-[var(--eos-green)]" /> Valid
              </footer>
            ) : result ? (
              <footer className="flex flex-col gap-1.5 border-t border-border bg-[color-mix(in_srgb,var(--eos-red)_7%,transparent)] px-4 pt-3 pb-3.5">
                <button
                  type="button"
                  className="flex items-center gap-2 text-left text-caption font-medium"
                  onClick={() => editorRef.current?.focusLine(result.error.line, result.error.column)}
                >
                  <TriangleAlert className="size-3.5 text-destructive" />
                  {status}
                </button>
                {result.error.snippet && (
                  <pre className="pl-[22px] font-mono text-caption whitespace-pre text-muted-foreground">{result.error.snippet}</pre>
                )}
              </footer>
            ) : null}
          </Panel>
        </ResizablePanel>
        {/* Stacked on small screens: a hairline instead of a gap, so both panes stay flush. */}
        <ResizeHandle
          className={mobile ? "h-px! bg-border before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']" : undefined}
        />
        <ResizablePanel id="preview" minSize={mobile ? "160px" : "320px"} className="flex">
          <Panel as="section" split="end" className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <PanelHeader title="Preview">
              <ZoomMenu />
              <ExportMenu actions={actions} />
            </PanelHeader>
            <div className="relative min-h-0 flex-1">
              <Preview
                source={result?.ok ? (shown ?? "") : lastValid.current}
                stale={!result?.ok && !!lastValid.current}
                onSvg={(el) => (svgRef.current = el)}
              />
              {result && !result.ok && (
                <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--eos-line-active)] bg-accent px-3 py-1.5 text-caption whitespace-nowrap text-muted-foreground">
                  <TriangleAlert className="size-3.5 text-destructive" /> Couldn’t render — showing the last valid version
                </div>
              )}
            </div>
          </Panel>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Page>
  )
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-[var(--eos-line-hover)] bg-card px-3 py-1.5 text-body md:mr-2">
      {children}
    </div>
  )
}

function TitleInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  // What's typed and not yet committed; a new title from elsewhere replaces it, as it does the draft.
  const typed = useRef<string | null>(null)
  useEffect(() => {
    setDraft(value)
    typed.current = null
  }, [value])
  const commit = () => {
    if (typed.current !== null && typed.current !== value) onCommit(typed.current)
    typed.current = null
  }
  // Leaving the diagram (going back, a swipe, an agent opening another page) unmounts this
  // without a blur, so a title still being typed is committed then. StrictMode's extra
  // unmount in dev comes before anything is typed, so it commits nothing.
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })
  useEffect(() => () => commitRef.current(), [])
  return (
    <input
      aria-label="Diagram title"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        typed.current = e.target.value
      }}
      onBlur={commit}
      // Not the Enter that confirms an IME candidate (Safari sends it as keyCode 229 just after composing).
      onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && (e.target as HTMLInputElement).blur()}
      className="field-sizing-content max-w-full min-w-[4ch] rounded-md bg-transparent px-1.5 py-1 outline-none hover:bg-accent/50 focus:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

function IconButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled} className="text-muted-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-2 text-background/70">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function ZoomMenu() {
  const scale = useUi((s) => s.zoomScale)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Zoom ${Math.round(scale * 100)}%`} className="tabular-nums">
          {Math.round(scale * 100)}% <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => requestZoom("in")}>
          Zoom in <DropdownMenuShortcut>⌘ +</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => requestZoom("out")}>
          Zoom out <DropdownMenuShortcut>⌘ −</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => requestZoom("fit")}>
          Zoom to fit <DropdownMenuShortcut>⇧ 1</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => requestZoom("actual")}>
          Actual size <DropdownMenuShortcut>⇧ 0</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function useShortcuts(actions: ReturnType<typeof useExportActions>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const inText = (e.target as HTMLElement | null)?.closest?.(".cm-editor, input, textarea")
      const action =
        mod && (e.key === "=" || e.key === "+")
          ? () => requestZoom("in")
          : mod && e.key === "-"
            ? () => requestZoom("out")
            : mod && e.shiftKey && e.key.toLowerCase() === "l"
              ? () => void actions.copyShareLink()
              : mod && e.shiftKey && e.key.toLowerCase() === "c"
                ? () => void actions.copySvg()
                : !inText && e.shiftKey && e.code === "Digit1"
                  ? () => requestZoom("fit")
                  : !inText && e.shiftKey && e.code === "Digit0"
                    ? () => requestZoom("actual")
                    : null
      if (!action) return
      // ⌘ shortcuts would otherwise zoom or act on the whole page.
      if (mod) e.preventDefault()
      action()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [actions])
}
