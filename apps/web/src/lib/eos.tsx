import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import type { AppSettings, DiagramId, DiagramIndexRow, DiagramSnapshot, Eos, LibraryFilter, TagRecord } from "@eos/core"

const EosContext = createContext<Eos | null>(null)

export function EosProvider({ eos, children }: { eos: Eos; children: ReactNode }) {
  return <EosContext.Provider value={eos}>{children}</EosContext.Provider>
}

export function useEos(): Eos {
  const eos = useContext(EosContext)
  if (!eos) throw new Error("useEos outside EosProvider")
  return eos
}

/** Re-runs `load` whenever one of `topics` fires. */
function useLive<T>(topics: Parameters<Eos["subscribe"]>[0][], load: (eos: Eos) => Promise<T>, deps: unknown[]): T | undefined {
  const eos = useEos()
  const [value, setValue] = useState<T>()
  useEffect(() => {
    let alive = true
    // Only the newest load may set the value: events come in bursts (e.g. a wipe, then an
    // import), and an older, slower load finishing last would show stale data.
    let latest = 0
    const run = () => {
      const n = ++latest
      load(eos).then((v) => alive && n === latest && setValue(v), console.error)
    }
    run()
    const offs = topics.map((t) => eos.subscribe(t, run))
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eos, ...deps])
  return value
}

export function useLibrary(filter: LibraryFilter): DiagramIndexRow[] | undefined {
  return useLive(["library"], (eos) => eos.listDiagrams(filter), [JSON.stringify(filter)])
}

export function useTags(): TagRecord[] | undefined {
  return useLive(["library"], (eos) => eos.listTags(), [])
}

export function useCounts() {
  return useLive(["library"], (eos) => eos.counts(), [])
}

export function useDiagram(id: DiagramId): DiagramSnapshot | null | undefined {
  return useLive(["library", `diagram:${id}`], (eos) => eos.getDiagram(id), [id])
}

export function useSettings(): AppSettings {
  const eos = useEos()
  const [settings, setSettings] = useState(eos.getSettings())
  useEffect(() => eos.subscribe("settings", () => setSettings(eos.getSettings())), [eos])
  return settings
}
