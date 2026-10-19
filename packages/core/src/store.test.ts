import "fake-indexeddb/auto"

import { describe, expect, it } from "vitest"

import { decodeShare, encodeShare } from "./share"
import { Eos } from "./store"

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

describe("share imports", () => {
  it("reuses an identical diagram instead of duplicating it", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ title: "Same", source: "pie\n  \"a\": 1" })
    expect(await eos.importShare({ title: "Same", source: "pie\n  \"a\": 1" })).toBe(id)
    expect(await eos.importShare({ title: "Same", source: "pie\n  \"a\": 2" })).not.toBe(id)
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
    await eos.createDiagram({ title: "Unrelated", source: "pie\n  \"a\": 1" })
    expect((await eos.listDiagrams({ query: "checkout" })).map((r) => r.id)).toEqual([title, body])
    expect((await eos.listDiagrams({ query: "chekout" })).map((r) => r.id)).toContain(title)
  })
})
