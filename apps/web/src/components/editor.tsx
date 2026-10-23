import {
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  PanelTopOpen,
  Redo2,
  Star,
  TriangleAlert,
  Undo2,
  History as HistoryIcon,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

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
import { useDefaultLayout, useGroupRef, usePanelRef } from "react-resizable-panels"

import { useDiagram, useEos } from "@/lib/eos"
import { useCopy } from "@/lib/use-copy"
import { togglePanel, useIsMobile, usePanelCollapsed } from "@/lib/layout"
import { homeHref } from "@/lib/router"
import { requestZoom, setUi, useUi } from "@/lib/ui-state"

import { CodeEditor, type CodeEditorHandle } from "./code-editor"
import { formatWhen, HistoryMenu } from "./history-menu"
import { ExportMenu, useExportActions } from "./export-menu"
import { Preview } from "./preview"
import { ResizeHandle } from "./resize-handle"
import { EmptyPage, Page, PageHeader, Panel, PanelHeader } from "./page"

// Settings' CSS editors take CodeMirror from here, so it has no download of its own to miss offline.
export { CodeEditor }

export function Editor({ id }: { id: string }) {
  const [copied, copy] = useCopy()
  const eos = useEos()
  const diagram = useDiagram(id)
  const [source, setSource] = useState<string | null>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)
  const pastRef = useRef<CodeEditorHandle | null>(null)

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

  const mobile = useIsMobile()
  const orientation = mobile ? "vertical" : "horizontal"
  const layout = useDefaultLayout({
    id: `eos-editor-${orientation}`,
    storage: localStorage,
  })
  // Whether the source pane is collapsed, as the panel has it: by its toggle, a drag, the keyboard on the splitter, or a
  // saved layout. Until the panel has mounted, the saved layout says where it can (collapsed to nothing, on desktop); a
  // phone's collapsed size is in pixels, which its saved percentages can't say.
  const sourcePanel = usePanelRef()
  const { collapsed, onResize } = usePanelCollapsed(sourcePanel, layout.defaultLayout?.source === 0)
  // Animated, as the sidebar's toggle is.
  const toggleSource = () => {
    const group = document.getElementById("source")?.parentElement
    if (sourcePanel.current) togglePanel(sourcePanel.current, group, group)
  }

  // Previewing a past version shows its source read-only in both panes.
  const preview = useUi((s) => s.preview)
  const previewing = preview?.id === id ? preview : null
  // Whether the live source can be reached: not while the pane is collapsed, nor while a past version shows. Everything
  // that hides it or makes it inert goes by this, and so does focus.
  const reachable = !collapsed && !previewing
  // Whenever that changes, or the layout does, focus and selection left somewhere now out of reach are put right before
  // the browser next renders, while they're still where the person had them. Focus goes to the live editor if it can
  // take it (as after Back to latest), otherwise to the source's toggle, the one control for it that's always there.
  // Focus on the page itself counts as lost only if it was in the banner or the past version's editor as they went
  // (React detaches their refs before it removes them); otherwise it's where the person left it. A selection out of
  // reach is still edited by execCommand in Firefox, and blocks typing elsewhere (see CodeEditor), so it goes; the live
  // editor's caret is in its state.
  const dropped = useRef(false)
  const dropsFocus = useCallback(
    (el: HTMLElement | null) => () => {
      if (el?.contains(document.activeElement)) dropped.current = true
    },
    []
  )
  useLayoutEffect(() => {
    const outOfReach = (node: Node | null | undefined) =>
      !!node && (!node.isConnected || !!(node instanceof Element ? node : node.parentElement)?.closest("[inert], [hidden]"))
    // Where focus is, before clearing the selection blurs the editor that has it.
    const focus = document.activeElement
    const lost = focus === document.body ? dropped.current : outOfReach(focus)
    dropped.current = false
    const selection = getSelection()
    if (outOfReach(selection?.anchorNode)) selection?.removeAllRanges()
    if (lost) {
      if (reachable) editorRef.current?.focus()
      else document.getElementById("source-toggle")?.focus()
    }
  }, [reachable, collapsed, mobile, previewing])
  // The past version's source, null until it has loaded, so its read-only editor starts with it.
  const [loaded, setLoaded] = useState<{ id: string; version: string; source: string } | null>(null)
  const previewSource = loaded?.id === id && loaded.version === previewing?.version ? loaded.source : null
  useEffect(() => {
    if (!previewing) return
    let alive = true
    eos.getSource(id, previewing.version).then(
      (source) => alive && setLoaded({ id, version: previewing.version, source }),
      () => {}
    )
    return () => {
      alive = false
    }
  }, [eos, id, previewing])
  const shown = previewing ? previewSource : source

  const result = useMemo(() => (shown === null ? null : validate(shown)), [shown])
  const lastValid = useRef<string>("")
  // A past version being previewed isn't the latest one, so it never stands in for it.
  if (result?.ok && shown !== null && !previewing) lastValid.current = shown
  // A past version that doesn't render shows nothing: the latest never stands in for it.
  // Until its text arrives (result is still null), the latest stays shown.
  const fallback = previewing && result ? "" : lastValid.current

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
  // Focus goes back to the live editor, where the person left it, rather than with the banner's buttons (see above).
  const backToLatest = () => setUi({ preview: null })
  const undo = () => void eos.undo(id).catch(() => {})
  const redo = () => void eos.redo(id).catch(() => {})

  const title = diagram?.meta.title ?? ""
  // What the preview draws: the version shown, or while its text doesn't render, the last good diagram.
  const drawn = result?.ok ? (shown ?? "") : fallback
  // Exports are of the version shown, as the preview draws it. Until a past
  // version's text arrives, the preview still shows the latest, and so do they.
  const actions = useExportActions(title, shown ?? source ?? "", drawn)

  useShortcuts(actions)
  // Each orientation keeps its own split. The group isn't remounted for the other one (that would lose the source's
  // caret, scroll and focus mid-edit, as a phone rotates), so it's given that one's split here. The source pane
  // changes shape, so the caret someone is typing at is brought back into view. Whether the source is hidden is the
  // person's choice, not the orientation's, so that carries over.
  const group = useGroupRef()
  useEffect(() => {
    group.current?.setLayout(layout.defaultLayout ?? { source: 42, preview: 58 })
    if (collapsed) sourcePanel.current?.collapse()
    else sourcePanel.current?.expand()
    for (const editor of [editorRef, pastRef]) editor.current?.keepCaretInView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation])

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
        <Banner ref={dropsFocus}>
          <HistoryIcon className="size-4 text-muted-foreground" />
          {/* Wraps rather than being cut off, and the buttons move to the next row together. */}
          <span className="min-w-0 grow basis-48">
            Viewing the version from {formatWhen(previewing.at)} · {previewing.label}
          </span>
          <div className="flex gap-x-2.5">
            <Button
              size="xs"
              className="text-label"
              onClick={async () => {
                await eos.restoreVersion(id, previewing.version)
                backToLatest()
              }}
            >
              Restore this version
            </Button>
            <Button size="xs" variant="ghost" className="text-label" onClick={backToLatest}>
              Back to latest
            </Button>
          </div>
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
      <ResizablePanelGroup groupRef={group} orientation={orientation} className="min-h-0 flex-1" {...layout}>
        {/* Collapsed, it's inert on desktop, so it takes no focus and screen readers skip it; on phones its header bar
            stays, and only what's below the header is. */}
        <ResizablePanel
          id="source"
          panelRef={sourcePanel}
          defaultSize="42%"
          minSize={mobile ? "120px" : "280px"}
          collapsible
          collapsedSize={mobile ? "48px" : "0px"}
          onResize={onResize}
          inert={collapsed && !mobile}
          className="flex"
        >
          <Panel as="section" split="start" className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <PanelHeader title="Source">
              {/* A past version is read-only, and undo would change the hidden latest text. */}
              {!previewing && (history.canUndo || history.canRedo) && (
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
            <div inert={collapsed} className="flex min-h-0 flex-1 flex-col">
              {previewing && previewSource !== null && (
                <div key={`preview:${previewing.version}`} ref={dropsFocus} className="contents">
                  <CodeEditor value={previewSource} readOnly errorAt={errorLine} handleRef={pastRef} />
                </div>
              )}
              {/* Hidden, not unmounted, while a past version shows, so its caret and scroll are there to come back to;
                  inert, so the selection it keeps takes no editing. */}
              {binding ? (
                <div hidden={!!previewing} inert={!reachable} className="flex min-h-0 flex-1 flex-col">
                  <CodeEditor
                    key={key}
                    binding={binding}
                    onChange={setSource}
                    onUndo={undo}
                    onRedo={redo}
                    errorAt={errorLine}
                    handleRef={editorRef}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1" />
              )}
              {result?.ok ? (
                <footer className="flex items-center gap-1.5 px-4 py-2.5 text-caption text-muted-foreground">
                  <CircleCheck className="size-3.5 text-[var(--eos-green)]" /> Valid
                </footer>
              ) : result ? (
                <footer className="flex flex-col gap-1.5 border-t border-border bg-[color-mix(in_srgb,var(--eos-red)_7%,transparent)] px-4 pt-3 pb-3.5">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left text-caption font-medium"
                    onClick={() => (previewing ? pastRef : editorRef).current?.focusLine(result.error.line, result.error.column)}
                  >
                    <TriangleAlert className="size-3.5 text-destructive" />
                    {status}
                  </button>
                  {result.error.snippet && (
                    <pre className="pl-[22px] font-mono text-caption whitespace-pre text-muted-foreground">{result.error.snippet}</pre>
                  )}
                </footer>
              ) : null}
            </div>
          </Panel>
        </ResizablePanel>
        {/* Stacked on small screens: a hairline instead of a gap, so both panes stay flush. */}
        <ResizeHandle
          className={mobile ? "h-px! bg-border before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']" : undefined}
        />
        <ResizablePanel id="preview" minSize={mobile ? "160px" : "320px"} className="flex">
          <Panel as="section" split="end" className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <PanelHeader
              title={
                <>
                  {/* One toggle, at the preview's leading edge in both layouts, so it's the same element on either
                      side of 768px and keeps focus as the layout changes. */}
                  <SourceToggle collapsed={collapsed} onToggle={toggleSource}>
                    {mobile ? collapsed ? <PanelTopOpen /> : <PanelTopClose /> : collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                  </SourceToggle>
                  <span className="ml-1.5">Preview</span>
                </>
              }
            >
              <ZoomMenu />
              <ExportMenu actions={actions} />
            </PanelHeader>
            <div className="relative min-h-0 flex-1">
              <Preview source={drawn} stale={!result?.ok && !!fallback} />
              {result && !result.ok && (
                <div className="absolute bottom-5 left-1/2 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-[var(--eos-line-active)] bg-accent px-3 py-1.5 text-center text-caption text-muted-foreground">
                  <TriangleAlert className="size-3.5 shrink-0 text-destructive" /> Couldn’t render
                  {fallback && " — showing the last valid version"}
                </div>
              )}
            </div>
          </Panel>
        </ResizablePanel>
      </ResizablePanelGroup>
      {/* Outside the panes, so it's read out whether or not the source is collapsed. */}
      <p role="status" className="sr-only">
        {announced}
      </p>
    </Page>
  )
}

function Banner({ ref, children }: { ref?: React.Ref<HTMLDivElement>; children: React.ReactNode }) {
  return (
    <div
      ref={ref}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-[var(--eos-line-hover)] bg-card px-3 py-1.5 text-body md:mr-2 md:group-data-[collapsed=true]/shell:ml-2"
    >
      {children}
    </div>
  )
}

function TitleInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  // What's typed and not yet committed; a new title from elsewhere replaces it, as it does the draft.
  const typed = useRef<string | null>(null)
  // The title saved on leaving the page (see below), which coming back as `value` leaves both alone.
  const saved = useRef<string | null>(null)
  useEffect(() => {
    if (value === saved.current) return void (saved.current = null)
    setDraft(value)
    typed.current = null
  }, [value])
  const commit = () => {
    if (typed.current !== null && typed.current !== value) onCommit(typed.current)
    typed.current = null
  }
  // Leaving the diagram (going back, a swipe, an agent opening another page) unmounts this
  // without a blur, so a title still being typed is committed then. StrictMode's extra
  // unmount in dev comes before anything is typed, so it commits nothing. Leaving the page
  // (a reload, closing the tab) does neither, so the title is also saved on beforeunload, the
  // one event early enough for a reload's write to land, and on pagehide; and when the page
  // is hidden, as switching tabs does, since a hidden tab may be discarded. The person may
  // come back and carry on typing, so that saves only a title that isn't blank, trimmed as
  // a commit would be, and leaves the field as it is: a blur or Enter still commits it.
  const save = () => {
    const title = typed.current?.trim()
    if (!title || title === value) return
    saved.current = title
    onCommit(title)
  }
  const latest = useRef({ commit, save })
  useEffect(() => {
    latest.current = { commit, save }
  })
  useEffect(() => {
    const onLeave = () => latest.current.save()
    const onHidden = () => document.visibilityState === "hidden" && latest.current.save()
    addEventListener("beforeunload", onLeave)
    addEventListener("pagehide", onLeave)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      removeEventListener("beforeunload", onLeave)
      removeEventListener("pagehide", onLeave)
      document.removeEventListener("visibilitychange", onHidden)
      latest.current.commit()
    }
  }, [])
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

/**
 * Hides and shows the source pane, and stays where it is either way, so focus stays on it. It's a disclosure, expanded
 * whenever the source shows, so unlike a menu's trigger it doesn't look pressed then. A click focuses it too, as
 * Safari's doesn't, so focus in the source it hides isn't left on the page.
 */
function SourceToggle({ collapsed, onToggle, children }: { collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  const label = collapsed ? "Show source" : "Hide source"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          id="source-toggle"
          aria-label={label}
          aria-expanded={!collapsed}
          aria-controls="source"
          onClick={(e) => {
            e.currentTarget.focus()
            onToggle()
          }}
          className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground dark:aria-expanded:hover:bg-muted/50"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
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
      // ⌘ shortcuts would otherwise zoom or act on the whole page; ⇧0 and ⇧1 act only off text fields, where their ")" and "!" have nowhere to go.
      e.preventDefault()
      action()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [actions])
}
