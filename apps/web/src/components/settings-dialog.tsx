import { ArrowUpRight, Bot, Copy, Database, Download, Heart, Info, Monitor, Moon, Palette, RotateCcw, Star, Sun } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import type { AppSettings, ThemeMode } from "@eos/core"
import { Button } from "@workspace/ui/components/button"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Dialog, DialogContent, DialogTitle } from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { useEos, useSettings } from "@/lib/eos"
import { download } from "@/lib/files"
import { currentAppCss, DEFAULT_DIAGRAM_CSS } from "@/lib/theme"
import type { CodeLanguage } from "@/lib/mermaid-language"
import { askConfirm, setUi, useUi } from "@/lib/ui-state"

import { CodeEditor } from "./code-editor"

const TABS = [
  { id: "theming", label: "Theming", icon: Palette },
  { id: "mcp", label: "MCP", icon: Bot },
  { id: "storage", label: "Storage", icon: Database },
  { id: "about", label: "About", icon: Info },
] as const

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  const tab = useUi((s) => s.settingsTab)
  return (
    <Dialog open={open} onOpenChange={(o) => setUi({ settingsOpen: o })}>
      {/* Sized to the window at every width; below 768px the section list becomes a row of tabs on top. */}
      <DialogContent className="flex h-[min(640px,calc(100dvh-2rem))] w-[min(1040px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0 max-md:flex-col sm:max-w-none">
        <nav className="flex shrink-0 gap-0.5 border-border bg-background/55 max-md:items-center max-md:overflow-x-auto max-md:border-b max-md:py-2 max-md:pr-12 max-md:pl-2 md:w-[232px] md:flex-col md:border-r md:px-2.5 md:pt-[18px]">
          <DialogTitle className="px-2.5 pb-3 text-title font-semibold max-md:sr-only">Settings</DialogTitle>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setUi({ settingsTab: id })}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-body text-muted-foreground outline-none hover:bg-accent/30 hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--eos-line-active)] max-md:h-9",
                tab === id && "bg-accent font-medium text-foreground",
              )}
            >
              <Icon className="size-4 max-md:hidden" />
              {/* The hidden medium-weight copy reserves the selected width, so selecting a tab never shifts the others. */}
              <span className="grid">
                <span className="col-start-1 row-start-1">{label}</span>
                <span aria-hidden className="invisible col-start-1 row-start-1 font-medium">
                  {label}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-7 pt-[22px] pb-5 max-md:px-4 max-md:pt-4">
          <h2 className="text-heading font-light">{TABS.find((t) => t.id === tab)?.label}</h2>
          {tab === "theming" && <Theming />}
          {tab === "mcp" && <Mcp />}
          {tab === "storage" && <Storage />}
          {tab === "about" && <About />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Theming() {
  const eos = useEos()
  const { theme } = useSettings()
  const [appCss, setAppCss] = useState(() => theme.customCss ?? currentAppCss())
  // Until the user edits it, the app CSS shows the active mode's values.
  const appDefault = useRef(theme.customCss ? null : appCss)
  useEffect(() => {
    if (theme.customCss || appDefault.current === null || appCss !== appDefault.current) return
    // Wait a tick so the new mode's class is on <html> before reading the variables.
    const t = setTimeout(() => {
      const next = currentAppCss()
      appDefault.current = next
      setAppCss(next)
    })
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.mode])
  const [diagramCss, setDiagramCss] = useState(theme.diagramCss ?? DEFAULT_DIAGRAM_CSS)
  const save = (patch: Partial<AppSettings["theme"]>) => eos.updateSettings({ theme: { ...theme, ...patch } })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-body font-medium">App theme</h3>
          <a
            href="https://github.com/campfireshuffle/eos/blob/main/docs/theming.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-caption text-muted-foreground hover:text-foreground"
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
          >
            <ToggleGroupItem value="light" aria-label="Light">
              <Sun /> Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark">
              <Moon /> Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="system" aria-label="System">
              <Monitor /> System
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <CssBox value={appCss} onChange={setAppCss} label="App theme CSS" />
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-body font-medium">Diagram theme</h3>
          <a
            href="https://pele.run/theming"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-caption text-muted-foreground hover:text-foreground"
          >
            Pele theming docs <ArrowUpRight className="size-3.5" />
          </a>
        </div>
        <CssBox value={diagramCss} onChange={setDiagramCss} label="Diagram theme CSS" />
      </section>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDiagramCss(DEFAULT_DIAGRAM_CSS)
            void save({ customCss: null, diagramCss: null }).then(() =>
              setTimeout(() => {
                const next = currentAppCss()
                appDefault.current = next
                setAppCss(next)
              }),
            )
          }}
        >
          <RotateCcw /> Reset to default
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() =>
            save({
              customCss: appCss === appDefault.current ? null : appCss,
              diagramCss: diagramCss === DEFAULT_DIAGRAM_CSS ? null : diagramCss,
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function CssBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex min-h-[140px] flex-1 overflow-hidden rounded-lg border border-input bg-background/40 focus-within:border-ring">
      <CodeEditor value={value} onChange={onChange} language="css" label={label} wrap />
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
        Eos offers its actions to AI agents through{" "}
        <a className={link} href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noreferrer">
          WebMCP
        </a>
        , a proposed browser standard. Any agent that speaks MCP can use them: create, edit, organise, theme and export
        diagrams. Eos asks you before an agent deletes anything.
      </p>
      <Step title="1. Turn on WebMCP in Chrome">
        <p className="text-body text-muted-foreground">
          In Chrome 150 or newer, open <code className="font-mono text-caption">chrome://flags/#enable-webmcp-testing</code>, set
          it to Enabled and relaunch.
        </p>
        <p className={cn("text-body", available ? "text-[var(--eos-green)]" : "text-muted-foreground")}>
          {available ? "WebMCP is on in this browser." : "WebMCP isn't on in this browser yet."}
        </p>
      </Step>
      <Step title="2. Connect your agent">
        <p className="text-body text-muted-foreground">
          Add{" "}
          <a className={link} href="https://github.com/ChromeDevTools/chrome-devtools-mcp" target="_blank" rel="noreferrer">
            Chrome DevTools MCP
          </a>{" "}
          to your agent's MCP servers. It connects to the Chrome you have open, so first turn on remote debugging at{" "}
          <code className="font-mono text-caption">chrome://inspect/#remote-debugging</code>.
        </p>
        <CodeBlock
          label="MCP config"
          language="json"
          code={JSON.stringify({ mcpServers: { eos: { command: "npx", args: MCP_ARGS } } }, null, 2)}
        />
        <p className="text-body text-muted-foreground">Or, for agents that take a command:</p>
        <CodeBlock label="Command" language="shell" code={`npx ${MCP_ARGS.join(" ")}`} />
      </Step>
      <Step title="3. Ask your agent">
        <p className="text-body text-muted-foreground">
          With Eos open, try “List the WebMCP tools on eos.lil.run”, then “Make a flowchart of our deploy process”. To use
          Chrome's built-in model instead, try the{" "}
          <a className={link} href="https://github.com/GoogleChromeLabs/webmcp-extension" target="_blank" rel="noreferrer">
            example WebMCP extension
          </a>
          .
        </p>
      </Step>
    </div>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body font-medium">{title}</h3>
      {children}
    </section>
  )
}

function CodeBlock({ label, code, language }: { label: string; code: string; language: CodeLanguage }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center border-b border-border py-1 pr-1.5 pl-3">
        <span className="flex-1 font-mono text-caption text-[var(--eos-faint)]">{label}</span>
        <Button variant="ghost" size="icon-xs" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(code)}>
          <Copy />
        </Button>
      </div>
      <div className="flex text-body [&_.cm-editor]:h-auto">
        <CodeEditor value={code} language={language} label={label} readOnly gutter={false} wrap />
      </div>
    </div>
  )
}

function Storage() {
  const eos = useEos()
  const [usage, setUsage] = useState<number | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void eos.storageUsage().then((u) => setUsage(u.usage))
  }, [eos])
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body">{usage === null ? "…" : `${formatBytes(usage)} used`}</p>
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
            if (f) await eos.importBackup(await f.text(), "merge")
            e.target.value = ""
          }}
        />
      </div>
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
      <div className="flex items-center gap-2">
        <span className="flex-1 text-body font-medium">Enjoying Eos?</span>
        <Button variant="outline" size="sm" asChild>
          <a href="https://github.com/campfireshuffle/eos" target="_blank" rel="noreferrer">
            <Star /> Star on GitHub
          </a>
        </Button>
        <Button size="sm" asChild>
          <a href="https://github.com/sponsors/campfireshuffle" target="_blank" rel="noreferrer">
            <Heart /> Donate
          </a>
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-[var(--eos-faint)]">Built with</span>
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
