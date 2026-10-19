import "fake-indexeddb/auto"

import { Eos } from "@eos/core"
import { describe, expect, it, vi } from "vitest"

import { createTools, registerTools, type UiBridge } from "./index"

const ui = (confirm = true): UiBridge => ({
  origin: "https://eos.lil.run",
  getView: () => ({}),
  openDiagram: vi.fn(),
  goHome: vi.fn(),
  setLibraryView: vi.fn(),
  setZoom: vi.fn(),
  openSettings: vi.fn(),
  previewVersion: vi.fn(),
  confirm: vi.fn(async () => confirm),
  download: vi.fn(),
})

let n = 0
async function setup(confirm = true) {
  const eos = await Eos.create({ dbName: `mcp-${n++}`, seed: false })
  const bridge = ui(confirm)
  const tools = Object.fromEntries(createTools(eos, bridge).map((t) => [t.name, t]))
  const call = (name: string, input: Record<string, unknown> = {}) => tools[name].execute(input) as Promise<any>
  return { eos, bridge, call }
}

describe("webmcp tools", () => {
  it("lets an agent create, edit, validate and undo", async () => {
    const { call, bridge } = await setup()
    const { id } = await call("create_diagram", { title: "Agent", source: "flowchart TD\n  A-->B", tags: ["work"] })
    expect(bridge.openDiagram).toHaveBeenCalledWith(id)
    expect((await call("patch_source", { id, edits: [{ line: 2, expect: "  A-->B", text: "  A-->C" }] })).ok).toBe(true)
    expect((await call("get_source", { id })).source).toBe("flowchart TD\n  A-->C")
    expect((await call("patch_source", { id, edits: [{ line: 2, expect: "nope", text: "x" }] })).code).toBe("stale")
    expect((await call("validate_source", { source: "flowchart TD\n  A --> {{x" })).code).toBe("parse_error")
    await call("undo", { id })
    expect((await call("get_source", { id })).source).toBe("flowchart TD\n  A-->B")
    const versions = (await call("list_versions", { id })).versions
    expect(versions.some((v: any) => v.actor.kind === "agent")).toBe(true)
  })

  it("asks before destructive actions", async () => {
    const { call, eos } = await setup(false)
    const { id } = await call("create_diagram", { title: "Keep me", open: false })
    expect((await call("delete_diagram", { id })).code).toBe("user_declined")
    expect((await eos.listDiagrams()).length).toBe(1)
  })

  it("organises and shares", async () => {
    const { call } = await setup()
    const { id } = await call("create_diagram", { title: "Share", source: "pie\n  \"a\": 1", open: false })
    await call("set_starred", { id, starred: true })
    await call("add_tags", { id, tags: ["Work/Backend"] })
    await call("set_tag_emoji", { path: "work", emoji: "💼" })
    expect((await call("list_diagrams", { starred: true, tags: ["work"] })).diagrams).toHaveLength(1)
    const { url } = await call("get_share_link", { id })
    expect(url).toMatch(/^https:\/\/eos\.lil\.run\/#\/import\?d=/)
    const imported = await call("import_share_link", { url, open: false })
    expect((await call("get_source", { id: imported.id })).source).toContain("pie")
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
