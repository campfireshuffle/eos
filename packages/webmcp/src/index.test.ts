import "fake-indexeddb/auto"

import { Eos } from "@eos/core"
import { describe, expect, it, vi } from "vitest"

import { createTools, registerTools, type UiBridge } from "./index"

const ui = (confirm: boolean | "busy" = true): UiBridge => ({
  origin: "https://eos.lil.run",
  getView: () => ({}),
  openDiagram: vi.fn(),
  goHome: vi.fn(),
  setLibraryView: vi.fn(),
  setZoom: vi.fn(),
  openSettings: vi.fn(),
  previewVersion: vi.fn(),
  confirm: vi.fn(async () => (confirm === "busy" ? "busy" : confirm ? "confirmed" : "declined")),
  download: vi.fn(),
  toPng: vi.fn(async () => ({ dataUrl: "data:image/png;base64,AA==", blob: new Blob() })),
  getTheme: () => ({ resolvedMode: "light", appCss: ":root {}", diagramCss: ".pele {}" }),
})

let n = 0
async function setup(confirm: boolean | "busy" = true) {
  const eos = await Eos.create({ dbName: `mcp-${n++}`, seed: false })
  const bridge = ui(confirm)
  const list = createTools(eos, bridge)
  const tools = Object.fromEntries(list.map((t) => [t.name, t]))
  const call = (name: string, input: Record<string, unknown> = {}) => tools[name].execute(input) as Promise<any>
  return { eos, bridge, call, list }
}

describe("webmcp tools", () => {
  it("exposes a small surface, with reads and permanent deletes annotated", async () => {
    const { list } = await setup()
    expect(list.map((t) => t.name)).toEqual([
      "get_library",
      "get_diagram",
      "get_view",
      "get_settings",
      "export",
      "create_diagram",
      "update_diagram",
      "update_tag",
      "set_view",
      "set_theme",
      "delete_tag",
      "import_backup",
      "delete_all_data",
    ])
    const ro = list.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name)
    expect(ro).toEqual(["get_library", "get_diagram", "get_view", "get_settings", "export"])
    // These return text people wrote, which an agent shouldn't take as instructions.
    expect(list.filter((t) => t.annotations?.untrustedContentHint).map((t) => t.name)).toEqual(["get_library", "get_diagram", "export"])
    const destructive = list.filter((t) => t.annotations?.destructiveHint).map((t) => t.name)
    expect(destructive).toEqual(["delete_tag", "import_backup", "delete_all_data"])
    // Chrome reads consequentialHint; destructiveHint alone is ignored there.
    expect(list.filter((t) => t.annotations?.consequentialHint).map((t) => t.name)).toEqual(destructive)
  })

  it("creates, edits in one change, refuses stale edits and undoes only its own work", async () => {
    const { call, bridge, eos } = await setup()
    const created = await call("create_diagram", { title: "Agent", source: "flowchart TD\n  A-->B", tags: ["work"] })
    expect(created.valid).toBe(true)
    expect(bridge.openDiagram).toHaveBeenCalledWith(created.id)
    const id = created.id

    const { version } = await call("get_diagram", { id })
    const edit = await call("update_diagram", {
      id,
      title: "Renamed",
      source: "flowchart TD\n  A-->C",
      addTags: ["work/api"],
      starred: true,
      expectedVersion: version,
    })
    expect(edit.ok).toBe(true)
    expect((await call("update_diagram", { id, title: "x", expectedVersion: version })).code).toBe("stale")

    // The agent's undo steps back its own text changes; title and tags are details, not undone.
    expect((await call("update_diagram", { id, revert: "undo" })).ok).toBe(true)
    let { diagram } = await call("get_diagram", { id })
    expect(diagram.source).toBe("flowchart TD\n  A-->B")
    expect(diagram.meta.title).toBe("Renamed")
    await call("update_diagram", { id, revert: "redo" })
    expect((await call("get_diagram", { id })).diagram.source).toBe("flowchart TD\n  A-->C")

    // You and the agent are equals: each undoes only their own edits, whoever edited last.
    await eos.setSource(id, "flowchart TD\n  A-->C\n  C-->P")
    await call("update_diagram", { id, source: "flowchart TD\n  Z-->C\n  C-->P" })
    expect((await call("update_diagram", { id, revert: "undo" })).ok).toBe(true)
    ;({ diagram } = await call("get_diagram", { id }))
    expect(diagram.source).toBe("flowchart TD\n  A-->C\n  C-->P") // the person's line stays
    await eos.undo(id)
    ;({ diagram } = await call("get_diagram", { id }))
    expect(diagram.source).toBe("flowchart TD\n  A-->C") // the person's ⌘Z removes only their line
    const { history } = await call("get_diagram", { id, history: true })
    expect(history.some((e: any) => e.actor.kind === "agent" && e.changes.includes("source"))).toBe(true)
    expect(history.some((e: any) => e.actor.kind === "user")).toBe(true)
  })

  it("merges its source from the version it edited, keeping what the person typed since", async () => {
    const { call, eos } = await setup()
    const { id } = await call("create_diagram", { source: "line one\nline two", open: false })
    const read = await call("get_diagram", { id })
    expect((await call("export", { id, format: "mmd" })).version).toBe(read.version)
    await eos.setSource(id, "line one\nline two\nperson's line") // typed while the agent was working
    const edit = await call("update_diagram", {
      id,
      source: read.diagram.source.replace("line one", "LINE ONE"),
      baseVersion: read.version,
    })
    // The person's line was merged in, so the result returns the source its version is at.
    expect(edit.source).toBe("LINE ONE\nline two\nperson's line")
    await eos.setSource(id, "LINE ONE\nline two\nperson's line\nanother")
    await call("update_diagram", { id, source: edit.source.replace("two", "TWO"), baseVersion: edit.version })
    expect((await call("get_diagram", { id })).diagram.source).toBe("LINE ONE\nline TWO\nperson's line\nanother")
    // Without a base, the source replaces the text.
    await call("update_diagram", { id, source: "replaced" })
    expect((await call("get_diagram", { id })).diagram.source).toBe("replaced")
    // An unknown base changes nothing, title included, and leaves the agent's undo working.
    expect((await call("update_diagram", { id, title: "T", source: "x", baseVersion: "bogus" })).code).toBe("not_found")
    const after = (await call("get_diagram", { id })).diagram
    expect([after.meta.title, after.source]).toEqual(["Untitled", "replaced"])
    await call("update_diagram", { id, revert: "undo" })
    expect((await call("get_diagram", { id })).diagram.source).toBe("LINE ONE\nline TWO\nperson's line\nanother")
  })

  it("reports parse errors and exports every format", async () => {
    const { call } = await setup()
    expect((await call("export", { format: "svg", source: "flowchart TD\n  A --> {{x" })).code).toBe("parse_error")
    const { id } = await call("create_diagram", { title: "Pie", source: 'pie\n  "a": 1', open: false })
    expect((await call("export", { id, format: "svg" })).data).toContain("<svg")
    expect((await call("export", { id, format: "png" })).data).toMatch(/^data:image\/png/)
    expect((await call("export", { id, format: "mmd" })).data).toContain("pie")
    const { url } = await call("export", { id, format: "link" })
    expect(url).toMatch(/^https:\/\/eos\.lil\.run\/#\/import\?d=/)
    expect(JSON.parse((await call("export", { format: "backup" })).data).diagrams).toHaveLength(1)
    const imported = await call("create_diagram", { fromShareLink: url, open: false })
    expect(imported.id).toBe(id) // identical diagrams aren't duplicated
  })

  it("organises tags and the library", async () => {
    const { call } = await setup()
    const { id } = await call("create_diagram", { title: "Tagged", source: "flowchart TD\n  A-->B", tags: ["work/backend"], open: false })
    await call("update_tag", { path: "work/backend", moveTo: "backend", emoji: "⚙️" })
    const lib = await call("get_library", { tags: ["backend"] })
    expect(lib.diagrams.map((d: any) => d.id)).toEqual([id])
    expect(lib.tags.find((t: any) => t.path === "backend").emoji).toBe("⚙️")
    expect(lib.diagrams[0].sourceText).toBeUndefined()
  })

  it("asks before deleting, and respects a no", async () => {
    const { call, eos } = await setup(false)
    const { id } = await call("create_diagram", { title: "Keep me", open: false })
    expect((await call("update_diagram", { id, deleted: true })).code).toBe("user_declined")
    // A declined delete leaves the rest of the edit undone too.
    expect((await call("update_diagram", { id, title: "Renamed", deleted: true })).code).toBe("user_declined")
    expect((await eos.getDiagram(id))?.meta.title).toBe("Keep me")
    expect((await call("delete_tag", { path: "x" })).code).toBe("user_declined")
    expect((await eos.listDiagrams()).length).toBe(1)
  })

  it("can't turn confirmations off by importing a backup", async () => {
    const { call, eos } = await setup(false)
    await call("create_diagram", { title: "Keep me", open: false })
    const data = JSON.stringify({ v: 1, diagrams: [], settings: { agent: { confirmDestructive: false } } })
    expect((await call("import_backup", { data, mode: "merge" })).ok).toBe(true)
    expect((await call("delete_all_data")).code).toBe("user_declined")
    expect((await eos.listDiagrams()).length).toBe(1)
  })

  it("reports busy, not a no, when another dialog is already open", async () => {
    const { call, eos } = await setup("busy")
    const { id } = await call("create_diagram", { title: "Keep me", open: false })
    expect(await call("update_diagram", { id, deleted: true })).toMatchObject({ ok: false, code: "busy" })
    expect((await eos.listDiagrams()).length).toBe(1)
  })

  it("rejects bad input with a clear error instead of throwing", async () => {
    const { call } = await setup()
    const { id } = await call("create_diagram", { title: "T", source: "flowchart TD\n  A-->B", open: false })
    expect(await call("update_diagram", { id, title: 42 })).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "input.title must be string, not number",
    })
    expect((await call("set_view", { library: { tag: "x" } })).message).toMatch(/input.library isn't a field/)
    expect((await call("set_view", { zoom: "huge" })).code).toBe("invalid_input")
    expect((await call("get_diagram", {})).message).toBe("input.id is required")
    expect((await call("export", { format: "svg" })).code).toBe("invalid_input")
    expect((await call("update_diagram", { id, revert: "bogus" })).code).toBe("not_found")
    expect((await call("get_diagram", { id, version: "bogus" })).code).toBe("not_found")
    expect((await call("import_backup", { data: "not json", mode: "merge" })).code).toBe("invalid_input")
    expect((await call("import_backup", { data: "{}", mode: "replace" })).code).toBe("invalid_input")
    expect((await call("update_tag", { path: "x", emoji: null })).ok).toBe(true)
  })

  it("reads and restores a version history has folded into a later entry", async () => {
    const { call } = await setup()
    const { id } = await call("create_diagram", { title: "V", source: "flowchart LR\n  A-->B", open: false })
    const { version: v1 } = await call("update_diagram", { id, source: "flowchart LR\n  A-->C" })
    await call("update_diagram", { id, source: "flowchart LR\n  A-->D" })
    // The agent's edits are one history entry now, but v1 is still a real version.
    const { history } = await call("get_diagram", { id, history: true })
    expect(history.some((e: any) => e.version === v1)).toBe(false)
    expect((await call("get_diagram", { id, version: v1 })).diagram.source).toContain("A-->C")
    expect((await call("update_diagram", { id, revert: v1 })).ok).toBe(true)
    expect((await call("get_diagram", { id })).diagram.source).toContain("A-->C")
  })

  it("returns starred as a boolean and one change list per history entry", async () => {
    const { call } = await setup()
    const { id } = await call("create_diagram", { title: "S", starred: true, open: false })
    expect((await call("get_library")).diagrams[0].starred).toBe(true)
    const { history } = await call("get_diagram", { id, history: true })
    expect(history[0].actor.changes).toBeUndefined()
    expect(history[0].changes).toContain("created")
  })

  it("goes home after the open diagram is wiped", async () => {
    const { call, bridge } = await setup()
    const { id } = await call("create_diagram", { title: "Gone" })
    bridge.getView = () => ({ route: { name: "diagram", id } })
    await call("delete_all_data")
    expect(bridge.goHome).toHaveBeenCalled()
  })

  it("describes input as strict JSON Schema", async () => {
    const { list } = await setup()
    const schema = list.find((t) => t.name === "update_diagram")!.inputSchema as any
    expect(schema.$schema).toBeUndefined()
    expect(schema).toMatchObject({ type: "object", required: ["id"], additionalProperties: false })
    expect(schema.properties.revert).toMatchObject({ type: "string", description: '"undo", "redo" or a version id' })
    const tag = list.find((t) => t.name === "update_tag")!.inputSchema as any
    expect(tag.properties.emoji.anyOf ?? tag.properties.emoji.type).toBeTruthy()
  })

  it("closes the confirm and reports cancelled when the agent cancels the call", async () => {
    const { list, bridge, eos } = await setup()
    // A confirm that stays open until the call's signal aborts, like the in-page dialog.
    bridge.confirm = vi.fn(
      (_m: string, _a?: string, signal?: AbortSignal) =>
        new Promise<"declined">((resolve) => signal?.addEventListener("abort", () => resolve("declined")))
    )
    const tools = Object.fromEntries(list.map((t) => [t.name, t]))
    const { id } = (await tools.create_diagram.execute({ title: "Keep", open: false })) as any
    const controller = new AbortController()
    const pending = tools.update_diagram.execute({ id, deleted: true }, { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: "cancelled" })
    expect((await eos.listDiagrams()).length).toBe(1)
    // Already cancelled: nothing is asked.
    expect(await tools.delete_all_data.execute({}, { signal: AbortSignal.abort() })).toMatchObject({ code: "cancelled" })
    expect(bridge.confirm).toHaveBeenCalledTimes(1)
  })

  it("reads and changes the theme", async () => {
    const { call } = await setup()
    expect((await call("get_settings")).theme.diagramCss).toBe(".pele {}")
    await call("set_theme", { mode: "dark", diagramCss: ".pele { --pele-fg: red; }" })
    const { theme } = await call("get_settings")
    expect(theme.mode).toBe("dark")
    expect(theme.overridden.diagram).toBe(true)
  })

  it("registers with modelContext when available", () => {
    const registered: string[] = []
    ;(globalThis as any).navigator ??= {}
    Object.defineProperty(globalThis.navigator, "modelContext", {
      configurable: true,
      value: { registerTool: (t: { name: string }) => registered.push(t.name) },
    })
    const off = registerTools([{ name: "x", description: "", inputSchema: {}, execute: async () => ({}) }])
    expect(registered).toEqual(["x"])
    off?.()
  })
})
