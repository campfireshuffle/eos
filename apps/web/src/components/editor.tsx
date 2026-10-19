import {
  
  
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

import { validate } from "@eos/core"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useDefaultLayout } from "react-resizable-panels"

import { useDiagram, useEos } from "@/lib/eos"
import { useIsMobile } from "@/lib/layout"
import { homeHref } from "@/lib/router"
import { getUi, requestZoom, setUi, useUi } from "@/lib/ui-state"

import { CodeEditor, type CodeEditorHandle } from "./code-editor"
import { formatWhen, HistoryMenu } from "./history-menu"
import { ExportMenu, useExportActions } from "./export-menu"
import { Preview } from "./preview"
import { ResizeHandle } from "./resize-handle"
import { HistoryNav } from "./history-nav"
import { SidebarToggle } from "./sidebar-toggle"

export function Editor({ id }: { id: string }) {
  const eos = useEos()
  const diagram = useDiagram(id)
  const [source, setSource] = useState<string | null>(null)
  const sentLocally = useRef(new Set<string>())
  const svgRef = useRef<SVGSVGElement | null>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)

  // Adopt store changes unless they are echoes of our own keystrokes.
  useEffect(() => {
    if (!diagram) return
    if (source === null || !sentLocally.current.has(diagram.source))
      setSource(diagram.source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram?.source])

  // Undo/redo only appear once this tab has something to undo or redo.
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  useEffect(() => {
    let alive = true
    void eos.canUndo(id).then((h) => alive && setHistory(h))
    return () => {
      alive = false
    }
  }, [eos, id, diagram?.source])

  // Previewing a past version shows its source read-only in both panes.
  const preview = useUi((s) => s.preview)
  const previewing = preview?.id === id ? preview : null
  const [previewSource, setPreviewSource] = useState<string | null>(null)
  useEffect(() => {
    if (!previewing) return setPreviewSource(null)
    let alive = true
    void eos.getSource(id, previewing.version).then((s) => alive && setPreviewSource(s))
    return () => {
      alive = false
    }
  }, [eos, id, previewing])
  // Leaving this diagram ends its preview (but not one just opened for another diagram).
  useEffect(() => () => void (getUi().preview?.id === id && setUi({ preview: null })), [id])
  const shown = previewing ? previewSource : source

  const result = useMemo(
    () => (shown === null ? null : validate(shown)),
    [shown]
  )
  const lastValid = useRef<string>("")
  if (result?.ok && shown !== null) lastValid.current = shown

  const onChange = (next: string) => {
    sentLocally.current.add(next)
    if (sentLocally.current.size > 200) sentLocally.current = new Set([next])
    setSource(next)
    void eos.setSource(id, next)
  }
  const undo = () => {
    sentLocally.current.clear()
    void eos.undo(id)
  }
  const redo = () => {
    sentLocally.current.clear()
    void eos.redo(id)
  }

  const title = diagram?.meta.title ?? ""
  const actions = useExportActions(title, source ?? "", () => svgRef.current)

  useShortcuts(actions)
  const mobile = useIsMobile()
  const orientation = mobile ? "vertical" : "horizontal"
  const layout = useDefaultLayout({
    id: `eos-editor-${orientation}`,
    storage: localStorage,
  })

  if (diagram === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-card text-sm text-muted-foreground md:rounded-tl-xl">
        This diagram doesn’t exist.
        <Button variant="outline" asChild>
          <a href={homeHref()}>Back to diagrams</a>
        </Button>
      </main>
    )
  }
  if (!diagram || source === null)
    return <main className="flex-1 bg-card md:rounded-tl-xl" />

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 max-md:h-svh">
      <div className="flex items-center gap-1.5 pt-1.5 pr-2 pl-1.5">
        <SidebarToggle />
        <HistoryNav />
        <TitleInput value={title} onCommit={(t) => eos.renameDiagram(id, t)} />
        <div className="flex-1" />
        <IconButton
          label={diagram.starred ? "Unstar" : "Star"}
          onClick={() => eos.setStarred(id, !diagram.starred)}
        >
          <Star
            className={
              diagram.starred
                ? "fill-[var(--eos-champagne)] text-[var(--eos-champagne)]"
                : ""
            }
          />
        </IconButton>
      </div>

      {previewing && (
        <Banner>
          <HistoryIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate">
            Viewing the version from {formatWhen(previewing.at)} · {previewing.label}
          </span>
          <Button
            size="xs"
            onClick={async () => {
              await eos.restoreVersion(id, previewing.version)
              setUi({ preview: null })
            }}
          >
            Restore this version
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setUi({ preview: null })}>
            Back to latest
          </Button>
        </Banner>
      )}
      {!previewing && diagram.deletedAt && (
        <Banner>
          <Trash2 className="size-4 text-muted-foreground" />
          <span className="flex-1">This diagram is deleted.</span>
          <Button size="xs" onClick={() => eos.restoreDiagram(id)}>
            <RotateCcw /> Restore
          </Button>
        </Banner>
      )}
      <ResizablePanelGroup
        key={orientation}
        orientation={orientation}
        className="min-h-0 flex-1"
        {...layout}
      >
        <ResizablePanel
          id="source"
          defaultSize="42%"
          minSize={mobile ? "120px" : "280px"}
          className="flex"
        >
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card md:rounded-t-xl">
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
              <IconButton
                label="Copy source"
                onClick={() => navigator.clipboard.writeText(shown ?? "")}
              >
                <Copy />
              </IconButton>
            </PanelHeader>
            <CodeEditor
              key={previewing ? `preview:${previewing.version}` : "live"}
              value={shown ?? ""}
              readOnly={!!previewing}
              onChange={previewing ? undefined : onChange}
              onUndo={previewing ? undefined : undo}
              onRedo={previewing ? undefined : redo}
              errorAt={result && !result.ok ? result.error.line || null : null}
              handleRef={editorRef}
            />
            {result?.ok ? (
              <footer className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground">
                <CircleCheck className="size-3.5 text-[var(--eos-green)]" />{" "}
                Valid
              </footer>
            ) : result ? (
              <footer className="flex flex-col gap-1.5 border-t border-border bg-[color-mix(in_srgb,var(--eos-red)_7%,transparent)] px-4 pt-3 pb-3.5">
                <button
                  type="button"
                  className="flex items-center gap-2 text-left text-xs font-medium"
                  onClick={() =>
                    editorRef.current?.focusLine(
                      result.error.line,
                      result.error.column
                    )
                  }
                >
                  <TriangleAlert className="size-3.5 text-destructive" />
                  {result.error.line > 0
                    ? `Line ${result.error.line}, column ${result.error.column}: `
                    : ""}
                  {result.error.message}
                </button>
                {result.error.snippet && (
                  <pre className="pl-[22px] font-mono text-xs whitespace-pre text-muted-foreground">
                    {result.error.snippet}
                  </pre>
                )}
              </footer>
            ) : null}
          </section>
        </ResizablePanel>
        {/* Stacked on small screens: a hairline instead of a gap, so both panes stay flush. */}
        <ResizeHandle className={mobile ? "h-px! bg-border before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']" : undefined} />
        <ResizablePanel
          id="preview"
          minSize={mobile ? "160px" : "320px"}
          className="flex"
        >
          <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-card md:rounded-tl-xl">
            <PanelHeader title="Preview">
              <ZoomMenu />
              <ExportMenu actions={actions} />
            </PanelHeader>
            <div className="relative min-h-0 flex-1">
              <Preview
                source={result?.ok ? (shown ?? "") : lastValid.current}
                valid={!!result?.ok || !lastValid.current}
                onSvg={(el) => (svgRef.current = el)}
              />
              {result && !result.ok && (
                <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--eos-line-active)] bg-accent px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <TriangleAlert className="size-3.5 text-destructive" />{" "}
                  Couldn’t render — showing the last valid version
                </div>
              )}
            </div>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--eos-line-hover)] bg-card px-3 py-1.5 text-[13px] md:mr-2">
      {children}
    </div>
  )
}

function TitleInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      aria-label="Diagram title"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) =>
        e.key === "Enter" && (e.target as HTMLInputElement).blur()
      }
      className="field-sizing-content min-w-[4ch] max-w-full rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent/50 focus:bg-accent"
    />
  )
}

function PanelHeader({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <header className="flex h-12 items-center gap-1 border-b border-border pr-2.5 pl-4">
      <span className="flex-1 text-[13px]">{title}</span>
      {children}
    </header>
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && (
          <span className="ml-2 text-muted-foreground">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function ZoomMenu() {
  const scale = useUi((s) => s.zoomScale)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="tabular-nums">
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
      const inText = (e.target as HTMLElement | null)?.closest?.(
        ".cm-editor, input, textarea"
      )
      if (mod && (e.key === "=" || e.key === "+"))
        (e.preventDefault(), requestZoom("in"))
      else if (mod && e.key === "-") (e.preventDefault(), requestZoom("out"))
      else if (mod && e.shiftKey && e.key.toLowerCase() === "l")
        (e.preventDefault(), void actions.copyShareLink())
      else if (mod && e.shiftKey && e.key.toLowerCase() === "c")
        (e.preventDefault(), void actions.copySvg())
      else if (!inText && e.shiftKey && e.code === "Digit1") requestZoom("fit")
      else if (!inText && e.shiftKey && e.code === "Digit0")
        requestZoom("actual")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [actions])
}
