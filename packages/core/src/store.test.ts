import "fake-indexeddb/auto"

import { describe, expect, it } from "vitest"

import { fromBase64, toBase64 } from "./base64"
import { decodeShare, encodeShare } from "./share"
import { Eos } from "./store"
import type { TextChange } from "./types"

let n = 0
const fresh = () => Eos.create({ dbName: `test-${n++}`, seed: false })

describe("Eos store", () => {
  it("creates, edits and lists diagrams", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ title: "A", source: "flowchart TD\n  A-->B\n", tags: ["#Work/Backend"] })
    await eos.setSource(id, "flowchart TD\n  A-->C\n")
    const d = await eos.getDiagram(id)
    expect(d?.source).toContain("A-->C")
    expect(d?.meta.tags).toEqual(["work/backend"])
    const rows = await eos.listDiagrams({ tags: ["work"] })
    expect(rows.map((r) => r.id)).toEqual([id])
  })

  it("undoes and redoes edits", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ source: "one" })
    await eos.setSource(id, "two")
    expect(await eos.undo(id)).toBe(true)
    expect(await eos.getSource(id)).toBe("one")
    expect(await eos.redo(id)).toBe(true)
    expect(await eos.getSource(id)).toBe("two")
  })

  it("stars, filters and builds the tag tree", async () => {
    const eos = await fresh()
    const a = await eos.createDiagram({ title: "a", tags: ["work/backend"] })
    await eos.createDiagram({ title: "b", tags: ["work/payments", "ideas"] })
    await eos.setStarred(a, true)
    expect((await eos.listDiagrams({ starred: true })).map((r) => r.id)).toEqual([a])
    await eos.setTagEmoji("work", "💼")
    const tree = await eos.listTags()
    const work = tree.find((t) => t.path === "work")!
    expect(work.count).toBe(2)
    expect(work.emoji).toBe("💼")
    expect(work.children.map((c) => c.path)).toEqual(["work/backend", "work/payments"])
  })

  it("deletes a tag and its nested tags from every diagram", async () => {
    const eos = await fresh()
    const a = await eos.createDiagram({ title: "a", tags: ["work/backend", "ideas"] })
    const b = await eos.createDiagram({ title: "b", tags: ["work"] })
    expect(await eos.deleteTag("work")).toBe(2)
    expect((await eos.getDiagram(a))?.meta.tags).toEqual(["ideas"])
    expect((await eos.getDiagram(b))?.meta.tags).toEqual([])
    expect((await eos.listTags()).map((t) => t.path)).toEqual(["ideas"])
  })

  it("soft-deletes, lists, restores and purges", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ title: "gone" })
    await eos.deleteDiagram(id)
    expect((await eos.listDiagrams()).length).toBe(0)
    expect((await eos.listDiagrams({ deleted: true })).map((r) => r.id)).toEqual([id])
    expect((await eos.counts()).deleted).toBe(1)
    await eos.restoreDiagram(id)
    expect((await eos.listDiagrams()).length).toBe(1)
    await eos.deleteDiagram(id)
    await eos.purge(id)
    expect((await eos.listDiagrams({ includeDeleted: true })).length).toBe(0)
  })

  it("collapses a burst of edits into one history entry", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ source: "a" })
    for (const s of ["ab", "abc", "abcd"]) await eos.setSource(id, s)
    await eos.setSource(id, "agent", { kind: "agent", tool: "set_source" })
    const h = await eos.history(id)
    expect(h.map((e) => e.actor.kind)).toEqual(["agent", "user", "system"].filter((k) => h.some((e) => e.actor.kind === k)))
    expect(h.filter((e) => e.actor.kind === "user").length).toBe(1)
    const userEntry = h.find((e) => e.actor.kind === "user")!
    expect(await eos.getSource(id, userEntry.version)).toBe("abcd")
  })

  it("persists across instances", async () => {
    const name = `persist-${n++}`
    const first = await Eos.create({ dbName: name, seed: false })
    const id = await first.createDiagram({ title: "Keep", source: "x" })
    await first.setSource(id, "y")
    await new Promise((r) => setTimeout(r, 50))
    const second = await Eos.create({ dbName: name, seed: false })
    expect(await second.getSource(id)).toBe("y")
  })

  it("round-trips backups", async () => {
    const a = await fresh()
    const id = await a.createDiagram({ title: "Backed up", source: "z" })
    const backup = await a.exportBackup()
    const b = await fresh()
    await b.importBackup(backup, "merge")
    expect(await b.getSource(id)).toBe("z")
  })
})

describe("editor binding", () => {
  /** What a bound editor does with reported changes. */
  const apply = (text: string, changes: TextChange[]) =>
    [...changes].reverse().reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
  /** An editor bound to a diagram: types with edit() and follows everything else through onChange. */
  async function editor(eos: Eos, id: string) {
    const binding = await eos.bindSource(id)
    const state = { text: binding.text() }
    binding.onChange((changes) => (state.text = apply(state.text, changes)))
    const type = (at: number, insert: string) => {
      const change = { from: at, to: at, insert }
      state.text = apply(state.text, [change])
      binding.edit([change])
    }
    return { state, type, binding }
  }
  const settle = () => new Promise((r) => setTimeout(r, 50))

  it("merges two tabs typing at once, keystroke by keystroke", async () => {
    const name = `tabs-${n++}`
    const one = await Eos.create({ dbName: name, seed: false })
    const id = await one.createDiagram({ source: "line one\nline two" })
    const two = await Eos.create({ dbName: name, seed: false })
    const a = await editor(one, id)
    const b = await editor(two, id)
    // Interleaved keystrokes, each tab typing before it has heard the other's last one.
    for (const ch of "AAAA") {
      a.type(a.state.text.indexOf("\n"), ch)
      b.type(b.state.text.length, ch.toLowerCase().replace("a", "b"))
    }
    await settle()
    expect(a.state.text).toBe("line oneAAAA\nline twobbbb")
    expect(b.state.text).toBe(a.state.text)
    expect(await one.getSource(id)).toBe(a.state.text)
  })

  it("undoes a whole burst of typing even when another tab's keystrokes landed mid-burst", async () => {
    const name = `burst-${n++}`
    const one = await Eos.create({ dbName: name, seed: false })
    const id = await one.createDiagram({ source: "one\nthree" })
    const two = await Eos.create({ dbName: name, seed: false })
    const a = await editor(one, id)
    const b = await editor(two, id)
    for (const ch of "aaaa") {
      a.type(3, ch)
      await settle()
      b.type(b.state.text.length, "b")
      await settle()
    }
    expect(a.state.text).toBe("oneaaaa\nthreebbbb")
    expect(await one.undo(id)).toBe(true)
    await settle()
    expect(a.state.text).toBe("one\nthreebbbb")
    expect(b.state.text).toBe(a.state.text)
  })

  it("tells a binding when its diagram is closed, and stops editing it", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ source: "keep" })
    const ed = await editor(eos, id)
    let closed = false
    ed.binding.onClose(() => (closed = true))
    await eos.deleteAll()
    expect(closed).toBe(true)
    ed.binding.edit([{ from: 0, to: 0, insert: "lost? " }]) // a no-op, not a write to a dead doc
    expect(await eos.getDiagram(id)).toBeNull()
  })

  it("shows agent edits, undo and redo in the editor without echoing its own keystrokes", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ source: "flowchart TD\n  A --> B" })
    const ed = await editor(eos, id)
    const heard: TextChange[][] = []
    ed.binding.onChange((c) => heard.push(c))
    ed.type(ed.state.text.length, "\n  B --> C")
    expect(heard).toEqual([]) // its own keystroke isn't reported back
    await eos.editDiagram(id, { source: ed.state.text + "\n  C --> D" }, { kind: "agent", tool: "update_diagram" })
    expect(ed.state.text).toContain("C --> D")
    expect(await eos.undo(id)).toBe(true) // the person's undo skips the agent's edit
    expect(ed.state.text).toBe("flowchart TD\n  A --> B\n  C --> D")
    expect(await eos.redo(id)).toBe(true)
    expect(ed.state.text).toBe(await eos.getSource(id))
    expect(ed.state.text).toContain("B --> C")
  })
})

describe("backup import", () => {
  it("rejects a file that isn't a backup without touching the library", async () => {
    const eos = await fresh()
    await eos.createDiagram({ title: "Keep me" })
    await expect(eos.importBackup("not json", "replace")).rejects.toThrow(/isn't an Eos backup/)
    await expect(eos.importBackup(JSON.stringify({ v: 1, diagrams: [{ id: 1 }] }), "replace")).rejects.toThrow(/isn't an Eos backup/)
    await expect(eos.importBackup(JSON.stringify({ v: 2, diagrams: [] }), "replace")).rejects.toThrow(/isn't an Eos backup/)
    const damaged = JSON.stringify({ v: 1, diagrams: [{ id: "x", snapshot: "%%% not base64 %%%" }] })
    await expect(eos.importBackup(damaged, "replace")).rejects.toThrow(/damaged/)
    expect((await eos.listDiagrams()).map((d) => d.title)).toEqual(["Keep me"])
  })
})

describe("base64", () => {
  // What Eos wrote before switching to the shared helper; old links and backups must still decode.
  const legacyUrl = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  it("matches the old encoding byte for byte", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256)
    expect(toBase64(bytes, "base64url")).toBe(legacyUrl(bytes))
    expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)))
    expect(fromBase64(legacyUrl(bytes), "base64url")).toEqual(bytes)
  })

  it("round-trips snapshots larger than one chunk", () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => i % 251)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})

describe("share imports", () => {
  it("reuses an identical diagram instead of duplicating it", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ title: "Same", source: 'pie\n  "a": 1' })
    expect(await eos.importShare({ title: "Same", source: 'pie\n  "a": 1' })).toBe(id)
    expect(await eos.importShare({ title: "Same", source: 'pie\n  "a": 2' })).not.toBe(id)
    expect((await eos.listDiagrams()).length).toBe(2)
  })
})

describe("share links", () => {
  it("round-trips a payload", async () => {
    const encoded = await encodeShare({ title: "T", source: "flowchart TD\n  A-->B", tags: ["x"] })
    expect(await decodeShare(encoded)).toEqual({ title: "T", source: "flowchart TD\n  A-->B", tags: ["x"] })
    expect(await decodeShare("garbage")).toBeNull()
  })

  it("fuzzy-searches titles first, then contents", async () => {
    const eos = await Eos.create({ dbName: `search-${Math.random()}`, seed: false })
    const body = await eos.createDiagram({ title: "Notes", source: "flowchart TD\n  Checkout --> Payment" })
    const title = await eos.createDiagram({ title: "Checkout flow", source: "flowchart TD\n  A --> B" })
    await eos.createDiagram({ title: "Unrelated", source: 'pie\n  "a": 1' })
    expect((await eos.listDiagrams({ query: "checkout" })).map((r) => r.id)).toEqual([title, body])
    expect((await eos.listDiagrams({ query: "chekout" })).map((r) => r.id)).toContain(title)
  })

  it("keeps agent edits out of the person's undo stack, and groups them in history", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ title: "Mixed", source: "flowchart TD\n  A-->B" })
    await eos.setSource(id, "flowchart TD\n  A-->B\n  B-->C")
    await eos.editDiagram(
      id,
      { title: "Agent title", addTags: ["ai"] },
      { kind: "agent", tool: "update_diagram", changes: ["title", "tags"] }
    )
    await eos.editDiagram(
      id,
      { source: "flowchart TD\n  A-->B\n  B-->C\n  C-->D" },
      { kind: "agent", tool: "update_diagram", changes: ["source"] }
    )

    // The person's undo reverts their own edit and leaves the agent's title, tags and line alone.
    await eos.undo(id)
    let d = (await eos.getDiagram(id))!
    expect(d.meta.title).toBe("Agent title")
    expect(d.meta.tags).toEqual(["ai"])
    expect(d.source).toContain("C-->D")
    expect(d.source).not.toContain("B-->C")

    // The agent's undo reverts only the agent's last edit.
    await eos.undo(id, "agent")
    d = (await eos.getDiagram(id))!
    expect(d.source).not.toContain("C-->D")
    expect(d.meta.title).toBe("Agent title")

    // Newest first: agent undo, the person's undo, the agent's two edits (grouped), the person's edit, creation.
    const kinds = (await eos.history(id)).map((e) => [e.actor.kind, e.changes?.sort()])
    expect(kinds).toEqual([
      ["agent", ["undo"]],
      ["user", undefined],
      ["agent", ["source", "tags", "title"]],
      ["user", undefined],
    ])
  })
})
