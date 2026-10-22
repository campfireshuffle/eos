import {
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  Database,
  Download,
  Heart,
  Info,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Star,
  Sun,
  X,
} from "lucide-react"
import { Fragment, lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react"

import type { AppSettings, ThemeMode } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Dialog, DialogTitle } from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { useEos, useSettings, useStorageUsage } from "@/lib/eos"
import { useCopy } from "@/lib/use-copy"
import { download } from "@/lib/files"
import { applyTheme, changedVars, currentAppCss, DEFAULT_DIAGRAM_CSS } from "@/lib/theme"
import type { CodeLanguage } from "@/lib/mermaid-language"
import { askConfirm, setUi, useUi } from "@/lib/ui-state"

// CodeMirror is part of the editor's download; Settings fetches it when first opened.
const CodeEditor = lazy(() => import("./code-editor").then((m) => ({ default: m.CodeEditor })))

const TABS = [
  { id: "theming", label: "Theming", icon: Palette },
  { id: "mcp", label: "MCP", icon: Bot },
  { id: "storage", label: "Storage", icon: Database },
  { id: "about", label: "About", icon: Info },
] as const

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  const tab = useUi((s) => s.settingsTab)
  const title = useId()
  return (
    // Sized to the window at every width; below 768px the section list becomes a row of tabs on top.
    <Dialog
      open={open}
      onClose={() => setUi({ settingsOpen: false })}
      closeOnBackdrop
      aria-labelledby={title}
      className="m-auto h-[min(640px,calc(100dvh-2rem))] max-h-none w-[min(1040px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl ring-1 ring-foreground/10 open:flex max-md:flex-col"
    >
      {/* On phones the close button sits at the right of this row, so the tabs scroll in the space to its left. */}
      <nav className="flex shrink-0 border-border bg-background/55 max-md:border-b max-md:py-2 max-md:pr-11 max-md:pl-2 md:w-[232px] md:flex-col md:border-r md:px-2.5 md:pt-[18px]">
        <DialogTitle id={title} className="px-2.5 pb-3 leading-none max-md:sr-only">
          Settings
        </DialogTitle>
        <div className="flex min-w-0 gap-0.5 [scrollbar-width:none] max-md:items-center max-md:overflow-x-auto max-md:[mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] md:flex-col">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id || undefined}
              onClick={() => setUi({ settingsTab: id })}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-label text-muted-foreground outline-none hover:bg-accent/30 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring max-md:h-9 max-md:px-2",
                tab === id && "bg-accent text-foreground"
              )}
            >
              <Icon className="size-4 max-md:hidden" />
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-7 pt-[22px] pb-5 max-md:px-4 max-md:pt-4">
        <h2 className="text-heading">{TABS.find((t) => t.id === tab)?.label}</h2>
        {tab === "theming" && <Theming />}
        {tab === "mcp" && <Mcp />}
        {tab === "storage" && <Storage />}
        {tab === "about" && <About />}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        onClick={() => setUi({ settingsOpen: false })}
        className="absolute top-2 right-2"
      >
        <X />
      </Button>
    </Dialog>
  )
}

function Theming() {
  const eos = useEos()
  const { theme } = useSettings()
  // The editors are uncontrolled: new text comes with a new key, so the editor remounts with it.
  const [app, setApp] = useState(() => ({ css: theme.customCss ?? currentAppCss(), key: 0 }))
  const [diagram, setDiagram] = useState(() => ({ css: theme.diagramCss ?? DEFAULT_DIAGRAM_CSS, key: 0 }))
  // What the editors hold now.
  const typed = useRef({ app: app.css, diagram: diagram.css })
  // The app CSS pre-fill (the active mode's values), or null while saved CSS is shown.
  const appDefault = useRef(theme.customCss ? null : app.css)
  const fillApp = (css: string) => {
    appDefault.current = typed.current.app = css
    setApp((f) => ({ css, key: f.key + 1 }))
  }
  useEffect(() => {
    // Until it's edited, the app CSS shows the active mode's values.
    if (theme.customCss || typed.current.app !== appDefault.current) return
    // App applies the new mode only after this renders, and the pre-fill is read from the page.
    applyTheme(theme)
    const next = currentAppCss()
    if (next !== appDefault.current) fillApp(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.mode])
  const save = (patch: Partial<AppSettings["theme"]>) => eos.updateSettings({ theme: { ...theme, ...patch } })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <section className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-label whitespace-nowrap">App theme</h3>
          <a
            href="https://github.com/campfireshuffle/eos/blob/main/docs/theming.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-caption whitespace-nowrap text-muted-foreground hover:text-foreground"
          >
            Theming reference <ArrowUpRight className="size-3.5" />
          </a>
        </div>
        <div className="flex">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={theme.mode}
            onValueChange={(mode) => mode && void save({ mode: mode as ThemeMode })}
            aria-label="Color mode"
            className="max-sm:w-full"
          >
            <ToggleGroupItem value="light" aria-label="Light" className="max-sm:flex-1">
              <Sun /> Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark" className="max-sm:flex-1">
              <Moon /> Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="system" aria-label="System" className="max-sm:flex-1">
              <Monitor /> System
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <CssBox key={app.key} value={app.css} onChange={(v) => (typed.current.app = v)} label="App theme CSS" />
      </section>

      <section className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-label whitespace-nowrap">Diagram theme</h3>
          <a
            href="https://pele.run/theming"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-caption whitespace-nowrap text-muted-foreground hover:text-foreground"
          >
            Pele theming docs <ArrowUpRight className="size-3.5" />
          </a>
        </div>
        <CssBox key={diagram.key} value={diagram.css} onChange={(v) => (typed.current.diagram = v)} label="Diagram theme CSS" />
      </section>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            typed.current.diagram = DEFAULT_DIAGRAM_CSS
            setDiagram((f) => ({ css: DEFAULT_DIAGRAM_CSS, key: f.key + 1 }))
            applyTheme({ ...theme, customCss: null, diagramCss: null })
            fillApp(currentAppCss())
            void save({ customCss: null, diagramCss: null })
          }}
        >
          <RotateCcw /> Reset to default
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => {
            const { app, diagram } = typed.current
            void save({
              customCss: appDefault.current === null ? app : changedVars(app, appDefault.current),
              diagramCss: diagram === DEFAULT_DIAGRAM_CSS ? null : diagram,
            })
          }}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function CssBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex min-h-[140px] flex-1 overflow-hidden rounded-lg border border-input bg-background/40 [contain:size] [--editor-surface:color-mix(in_srgb,var(--background)_40%,var(--popover))] focus-within:border-ring">
      <Suspense fallback={null}>
        <CodeEditor value={value} onChange={onChange} language="css" label={label} />
      </Suspense>
    </div>
  )
}

const MCP_ARGS = ["-y", "chrome-devtools-mcp@latest", "--autoConnect", "--categoryExperimentalWebmcp=true"]
const link = "text-[var(--eos-champagne)] underline underline-offset-2"

/** Whether this browser exposes the WebMCP API (Chrome with the flag or origin trial). */
function webMcpAvailable() {
  return !!((document as { modelContext?: unknown }).modelContext ?? (navigator as { modelContext?: unknown }).modelContext)
}

function Mcp() {
  const available = webMcpAvailable()
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-muted-foreground">
        AI agents can use Eos through{" "}
        <a className={link} href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noreferrer">
          WebMCP
        </a>
        . Eos asks you before an agent deletes anything.
      </p>
      <Step title="1. Turn on WebMCP">
        <p className="text-body text-muted-foreground">In Chrome 150+, enable this flag and relaunch:</p>
        <ChromeUrl url="chrome://flags/#enable-webmcp-testing" />
        <p className={cn("text-caption", available ? "text-[var(--eos-green)]" : "text-[var(--eos-faint)]")}>
          {available ? "On in this browser" : "Not on in this browser yet"}
        </p>
      </Step>
      <Step title="2. Connect your agent">
        <p className="text-body text-muted-foreground">
          Agents built into the browser can use Eos once WebMCP is on. For an agent on your computer, like Claude Code or Cursor, turn on
          remote debugging:
        </p>
        <ChromeUrl url="chrome://inspect/#remote-debugging" />
        <p className="text-body text-muted-foreground">
          Then add{" "}
          <a className={link} href="https://github.com/ChromeDevTools/chrome-devtools-mcp" target="_blank" rel="noreferrer">
            Chrome DevTools MCP
          </a>{" "}
          to your agent:
        </p>
        <CodeBlock
          label="MCP config"
          language="json"
          code={JSON.stringify({ mcpServers: { eos: { command: "npx", args: MCP_ARGS } } }, null, 2)}
        />
      </Step>
      <Step title="3. Try it">
        <p className="text-body text-muted-foreground">Ask your agent to “list the WebMCP tools on eos.lil.run”.</p>
      </Step>
    </div>
  )
}

/**
 * A chrome:// address. Browsers don't let pages open these, so clicking copies it
 * for pasting into the address bar.
 */
function ChromeUrl({ url }: { url: string }) {
  const [copied, copy] = useCopy()
  return (
    <button
      type="button"
      title="Copy, then paste into the address bar"
      aria-label={copied ? "Copied" : undefined}
      onClick={() => copy(url)}
      className="flex w-full items-center justify-between gap-2 rounded-md bg-background px-2.5 py-1.5 text-left font-mono text-caption text-foreground hover:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      {/* Wrap only after a / or #, so a narrow screen never splits a word. */}
      <span className="[overflow-wrap:anywhere]">
        {url.split(/(?<=[/#])/).map((part, i) => (
          <Fragment key={i}>
            {part}
            <wbr />
          </Fragment>
        ))}
      </span>
      {copied ? <Check className="text-[var(--eos-green)]" /> : <Copy className="text-muted-foreground" />}
    </button>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label">{title}</h3>
      {children}
    </section>
  )
}

function CodeBlock({ label, code, language }: { label: string; code: string; language: CodeLanguage }) {
  const [copied, copy] = useCopy()
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center border-b border-border py-1 pr-1.5 pl-3">
        <span className="flex-1 font-mono text-caption text-[var(--eos-faint)]">{label}</span>
        <Button variant="ghost" size="icon-xs" aria-label={copied ? "Copied" : `Copy ${label}`} onClick={() => copy(code)}>
          {copied ? <Check className="text-[var(--eos-green)]" /> : <Copy />}
        </Button>
      </div>
      <div className="flex text-body [&_.cm-editor]:h-auto">
        <Suspense
          fallback={<pre className="overflow-x-auto px-3 py-2.5 font-mono text-[length:var(--eos-fs-code)] leading-[1.72]">{code}</pre>}
        >
          <CodeEditor value={code} language={language} label={label} readOnly gutter={false} />
        </Suspense>
      </div>
    </div>
  )
}

function Storage() {
  const eos = useEos()
  const usage = useStorageUsage()
  const [importError, setImportError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body">{usage === undefined ? "…" : `${formatBytes(usage)} used`}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={async () => download("eos-backup.json", await eos.exportBackup(), "application/json")}>
          <Download /> Export backup
        </Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          Import backup
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            if (await askConfirm("Delete all diagrams in this browser? This can’t be undone.")) await eos.deleteAll()
          }}
        >
          Delete all diagrams
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            setImportError(null)
            if (!f) return
            try {
              await eos.importBackup(await f.text(), "merge")
            } catch (error) {
              setImportError((error as Error).message)
            }
          }}
        />
      </div>
      {importError && (
        <p role="alert" className="-mt-2 text-caption text-destructive">
          {importError}
        </p>
      )}
    </div>
  )
}

function About() {
  const credits: [string, string][] = [
    ["Pele", "https://pele.run"],
    ["Mermaid", "https://mermaid.js.org"],
    ["Loro", "https://loro.dev"],
    ["CodeMirror", "https://codemirror.net"],
    ["shadcn/ui · Lucide", "https://ui.shadcn.com"],
  ]
  return (
    <div className="flex flex-col gap-5">
      <p className="-mt-3 text-body text-muted-foreground">Eos is a local-first Mermaid editor.</p>
      {/* On phones the question takes its own line and the two buttons share the next. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="basis-full text-label sm:flex-1 sm:basis-0">Enjoying Eos?</span>
        <Button variant="outline" size="sm" className="max-sm:flex-1" asChild>
          <a href="https://github.com/campfireshuffle/eos" target="_blank" rel="noreferrer">
            <Star /> Star on GitHub
          </a>
        </Button>
        <Button size="sm" className="max-sm:flex-1" asChild>
          <a href="https://github.com/sponsors/campfireshuffle" target="_blank" rel="noreferrer">
            <Heart /> Donate
          </a>
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-muted-foreground">Built with</span>
        {credits.map(([name, href]) => (
          <a key={name} href={href} target="_blank" rel="noreferrer" className="w-fit text-body hover:underline">
            {name}
          </a>
        ))}
      </div>
    </div>
  )
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}
