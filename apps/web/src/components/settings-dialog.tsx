import { Bot, Copy, Database, Download, Heart, Info, Monitor, Moon, Palette, RotateCcw, Star, Sun } from "lucide-react"
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
      <DialogContent className="flex h-[min(640px,90vh)] w-[1040px] max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[1040px]">
        <nav className="flex w-[232px] shrink-0 flex-col gap-0.5 border-r border-border bg-background/55 px-2.5 pt-[18px]">
          <DialogTitle className="px-2.5 pb-3 text-[15px] font-semibold">Settings</DialogTitle>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setUi({ settingsTab: id })}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                tab === id && "bg-accent font-medium text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-7 pt-[22px] pb-5">
          <h2 className="text-xl font-light">{TABS.find((t) => t.id === tab)?.label}</h2>
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
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-sm font-medium">App theme</h3>
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
        <h3 className="text-sm font-medium">Diagram theme</h3>
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
      <CodeEditor value={value} onChange={onChange} language="css" label={label} />
    </div>
  )
}

function Mcp() {
  return (
    <div className="flex flex-col gap-6">
      <Step title="1. Turn on WebMCP">
        <p className="text-[13px] text-muted-foreground">
          Use Chrome 149+ with the{" "}
          <a className="text-[var(--eos-champagne)] underline underline-offset-2" href="https://developer.chrome.com/origintrials/" target="_blank" rel="noreferrer">
            WebMCP origin trial
          </a>
          .
        </p>
      </Step>
      <Step title="2. Add Eos to your agent">
        <p className="text-[13px] text-muted-foreground">
          Install the{" "}
          <a className="text-[var(--eos-champagne)] underline underline-offset-2" href="https://www.npmjs.com/package/webmcp-server" target="_blank" rel="noreferrer">
            WebMCP bridge
          </a>
          , then add it to your agent:
        </p>
        <CodeBlock label="Claude Code" language="shell" code="claude mcp add webmcp -- npx webmcp-server" />
        <CodeBlock
          label="mcp.json"
          language="json"
          code={`{\n  "mcpServers": {\n    "webmcp": { "command": "npx", "args": ["webmcp-server"] }\n  }\n}`}
        />
      </Step>
    </div>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

function CodeBlock({ label, code, language }: { label: string; code: string; language: CodeLanguage }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center border-b border-border py-1 pr-1.5 pl-3">
        <span className="flex-1 font-mono text-[11px] text-[var(--eos-faint)]">{label}</span>
        <Button variant="ghost" size="icon-xs" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(code)}>
          <Copy />
        </Button>
      </div>
      <div className="flex text-[13px] [&_.cm-editor]:h-auto">
        <CodeEditor value={code} language={language} label={label} readOnly gutter={false} />
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
      <p className="text-[13px]">{usage === null ? "…" : `${formatBytes(usage)} used`}</p>
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
      <p className="-mt-3 text-[13px] text-muted-foreground">Eos is a local-first Mermaid editor.</p>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] font-medium">Enjoying Eos?</span>
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
        <span className="text-xs font-medium text-[var(--eos-faint)]">Built with</span>
        {credits.map(([name, href]) => (
          <a key={name} href={href} target="_blank" rel="noreferrer" className="w-fit text-[13px] hover:underline">
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
