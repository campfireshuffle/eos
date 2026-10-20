import "fake-indexeddb/auto"

import { LoroDoc, type LoroMap } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"

import { fromBase64, toBase64 } from "./base64"
import { openEosDB, type Database } from "./db"
import { compact, loadDoc } from "./docs"
import { decodeShare, encodeShare } from "./share"
import { Eos, UnknownVersionError } from "./store"
import type { Actor, DiagramIndexRow, TextChange } from "./types"

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
    expect((await eos.listDiagrams({ tags: ["#Work"] })).map((r) => r.id)).toEqual([id])
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

  describe("undo after a restore", () => {
    const agent: Actor = { kind: "agent", tool: "update_diagram", changes: ["source"] }
    const pause = () => new Promise((r) => setTimeout(r, 900)) // so the next edit starts a new burst

    it("lets the person undo past their own restore", async () => {
      const eos = await fresh()
      const id = await eos.createDiagram({ source: "flowchart TD\n  A --> B\n" })
      const v1 = (await eos.getDiagram(id))!.version
      await pause()
      await eos.setSource(id, "flowchart TD\n  A --> C\n  C --> D\n")
      await pause()
      await eos.restoreVersion(id, v1)
      await pause()
      expect(await eos.undo(id)).toBe(true)
      expect(await eos.getSource(id)).toBe("flowchart TD\n  A --> C\n  C --> D\n")
      expect(await eos.undo(id)).toBe(true)
      expect(await eos.getSource(id)).toBe("flowchart TD\n  A --> B\n")
    }, 10_000)

    it("doesn't apply a reversal twice when the person undoes after the agent restores", async () => {
      const eos = await fresh()
      const id = await eos.createDiagram({ source: "flowchart TD\n  A --> B\n" })
      const v1 = (await eos.getDiagram(id))!.version
      await pause()
      await eos.setSource(id, "flowchart TD\n  A --> C\n  C --> D\n")
      await pause()
      await eos.restoreVersion(id, v1, agent)
      await eos.undo(id)
      expect(await eos.getSource(id)).toBe("flowchart TD\n  A --> B\n")
    }, 10_000)

    it("doesn't apply a reversal twice when the agent undoes after the person restores", async () => {
      const eos = await fresh()
      const id = await eos.createDiagram({ source: "flowchart TD\n  A --> B\n  B --> C\n" })
      const v1 = (await eos.getDiagram(id))!.version
      await eos.setSource(id, "flowchart TD\n  A --> B\n", agent)
      await pause()
      await eos.restoreVersion(id, v1)
      await eos.undo(id, "agent")
      expect(await eos.getSource(id)).toBe("flowchart TD\n  A --> B\n  B --> C\n")
    }, 10_000)
  })

  it("rejects a version the diagram doesn't have, changing nothing", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ source: "one" })
    // Including ids Loro would panic on, leaving the diagram unusable.
    for (const version of ["bogus", "123:4", "1:-1", "1:1.5", "x:1", ","]) {
      await expect(eos.getSource(id, version)).rejects.toBeInstanceOf(UnknownVersionError)
      await expect(eos.restoreVersion(id, version)).rejects.toBeInstanceOf(UnknownVersionError)
      await expect(eos.editDiagram(id, { source: "two" }, undefined, { base: version })).rejects.toBeInstanceOf(UnknownVersionError)
    }
    expect(await eos.getSource(id)).toBe("one")
    expect((await eos.canUndo(id)).canUndo).toBe(false)
    await eos.setSource(id, "two")
    expect((await eos.history(id)).length).toBeGreaterThan(0)
    expect(await eos.getSource(id)).toBe("two")
  })

  it("merges an edit from an older version, keeping what the person deleted or typed next to what it removes", async () => {
    const eos = await fresh()
    // The text at the base, the person's text now, the edit made from the base, and the merge.
    const cases = [
      [
        "flowchart TD\n  A-->B\n  typo\n  C-->D",
        "flowchart TD\n  A-->B\n  C-->D",
        "flowchart TD\n  A-->B\n  C-->D",
        "flowchart TD\n  A-->B\n  C-->D",
      ],
      ["abcd", "acd", "abXcd", "aXcd"],
      ["line one\nline two", "line one\nline two\nperson's line", "LINE ONE\nline two", "LINE ONE\nline two\nperson's line"],
      // As Loro merges the same edit made on a fork at the base.
      ["abc", "abcX", "ab", "abX"],
      ["hello world", "hello world!", "totally new", "totally new!"],
      ["hello", "hello!", "", "!"],
      ["abcd", "abXcd", "acd", "aXcd"],
      ["a😀b", "a😀Xb", "ab", "aXb"],
      // An edit at the end of the old text stays there, before what the person added after it.
      ["A --> B", "A --> B\nC --> D", "A --> Z", "A --> Z\nC --> D"],
      ["ab", "abX", "abY", "abYX"],
      ["a😀", "a😀X", "a😀Y", "a😀YX"],
    ] as const
    for (const [base, person, edit, merged] of cases) {
      const id = await eos.createDiagram({ source: base })
      const version = (await eos.getDiagram(id))!.version
      await eos.setSource(id, person)
      await eos.editDiagram(id, { source: edit }, undefined, { base: version })
      expect(await eos.getSource(id)).toBe(merged)
    }
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

  it("moves a tag's emoji, and its nested tags' emoji, with the tag", async () => {
    const eos = await fresh()
    await eos.createDiagram({ title: "a", tags: ["work/backend"] })
    await eos.createDiagram({ title: "b", tags: ["eng"] })
    await eos.setTagEmoji("work", "💼")
    await eos.setTagEmoji("work/backend", "⚙️")
    await eos.setTagEmoji("eng", "🛠️")
    await eos.renameTag("work", "eng")
    const [eng] = await eos.listTags()
    // Merged into a tag with its own emoji, which it keeps.
    expect(eng.emoji).toBe("🛠️")
    expect(eng.children.map((c) => [c.path, c.emoji])).toEqual([["eng/backend", "⚙️"]])
    // Nothing is left behind under the old path to resurface if it's used again.
    await eos.createDiagram({ title: "c", tags: ["work"] })
    expect((await eos.listTags()).find((t) => t.path === "work")?.emoji).toBeNull()
  })

  it("purges for good, even a diagram that was open, and closes it in other tabs", async () => {
    const name = `purge-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const other = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ title: "gone", source: "secret" })
    await eos.setStarred(id, true)
    await eos.getSource(id)
    const binding = await other.bindSource(id)
    const closed = new Promise<void>((resolve) => binding.onClose(resolve))
    await eos.deleteDiagram(id)
    await eos.purge(id)
    await closed
    // The other tab's editor can't write the diagram back.
    binding.edit([{ from: 0, to: 0, insert: "x" }])
    const later = await Eos.create({ dbName: name, seed: false })
    await expect(later.getSource(id)).rejects.toThrow("not found")
    // Nor is its star kept, to come back with it from a backup.
    const workspace = new LoroDoc()
    workspace.import(fromBase64(JSON.parse(await later.exportBackup()).workspace))
    expect(workspace.getMap("starred").get(id)).toBeUndefined()
  })

  it("closes every open diagram in other tabs when everything is deleted", async () => {
    const name = `wipe-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const other = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ title: "gone" })
    const binding = await other.bindSource(id)
    const closed = new Promise<void>((resolve) => binding.onClose(resolve))
    await eos.deleteAll()
    await closed
    binding.edit([{ from: 0, to: 0, insert: "x" }])
    const later = await Eos.create({ dbName: name, seed: false })
    expect(await later.listDiagrams({ includeDeleted: true })).toEqual([])
    await expect(later.getSource(id)).rejects.toThrow("not found")
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

describe("durability", () => {
  const settle = () => new Promise((r) => setTimeout(r, 50))
  const dbOf = (eos: Eos) => (eos as unknown as { db: Database }).db
  /** Aborts writes to `store`, as a full disk would: just the next one, or every one until the returned restore. */
  function failWrites(method: "add" | "put", store: string, { once = false } = {}) {
    const original = IDBObjectStore.prototype[method]
    const restore = () => (IDBObjectStore.prototype[method] = original)
    IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      const request = original.apply(this, args)
      if (this.name === store) {
        this.transaction.abort()
        if (once) restore()
      }
      return request
    }
    return restore
  }

  it("keeps every later edit after one change fails to save", async () => {
    const name = `failed-write-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ source: "A" })
    await eos.setSource(id, "AB")
    await settle()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    failWrites("add", "updates", { once: true })
    await eos.setSource(id, "ABC") // fails to save
    await settle()
    await eos.setSource(id, "ABCD")
    await eos.setSource(id, "ABCDE")
    await settle()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
    const later = await Eos.create({ dbName: name, seed: false })
    expect(await later.getSource(id)).toBe("ABCDE")
  })

  it("saves a change that failed to save when the page goes away", async () => {
    const name = `failed-last-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ source: "A" })
    await settle()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    failWrites("add", "updates", { once: true })
    await eos.setSource(id, "AB") // fails to save, and no edit follows
    await settle()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
    ;(eos as unknown as { saveNow(): void }).saveNow() // what pagehide and hiding the tab run
    await settle()
    const later = await Eos.create({ dbName: name, seed: false })
    expect(await later.getSource(id)).toBe("AB")
  })

  it("saves the stars and tag emoji a backup brings in", async () => {
    const a = await fresh()
    const id = await a.createDiagram({ source: "x", tags: ["work"] })
    await a.setStarred(id, true)
    await a.setTagEmoji("work", "🔥")
    const backup = await a.exportBackup()
    for (const mode of ["replace", "merge"] as const) {
      const name = `backup-workspace-${mode}-${n++}`
      await (await Eos.create({ dbName: name, seed: false })).importBackup(backup, mode)
      await settle()
      const later = await Eos.create({ dbName: name, seed: false })
      expect((await later.listTags()).map((t) => t.emoji)).toEqual(["🔥"])
      await later.renameDiagram(id, "Renamed") // rewrites the index row from the saved stars
      expect((await later.listDiagrams())[0]?.starred).toBe(1)
    }
  })

  it("saves what a backup merges into a diagram that's open", async () => {
    const name = `backup-open-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ source: "base" })
    // A backup of the same diagram, edited elsewhere. Exporting opens the diagram here.
    const backup = JSON.parse(await eos.exportBackup()) as { diagrams: { snapshot: string }[] }
    const elsewhere = LoroDoc.fromSnapshot(fromBase64(backup.diagrams[0]!.snapshot))
    elsewhere.getText("source").insert(4, " + edit from elsewhere")
    elsewhere.commit()
    backup.diagrams[0]!.snapshot = toBase64(elsewhere.export({ mode: "snapshot" }))
    await eos.importBackup(JSON.stringify(backup), "merge")
    await settle()
    const later = await Eos.create({ dbName: name, seed: false })
    expect(await later.getSource(id)).toBe("base + edit from elsewhere")
  })

  it("shows what a backup brings in to other tabs that have it open", async () => {
    const name = `backup-tabs-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ source: "base" })
    const other = await Eos.create({ dbName: name, seed: false })
    expect(await other.getSource(id)).toBe("base") // open there too
    const backup = JSON.parse(await eos.exportBackup()) as { diagrams: { snapshot: string }[] }
    const elsewhere = LoroDoc.fromSnapshot(fromBase64(backup.diagrams[0]!.snapshot))
    elsewhere.getText("source").insert(4, "!")
    elsewhere.commit()
    backup.diagrams[0]!.snapshot = toBase64(elsewhere.export({ mode: "snapshot" }))
    await eos.importBackup(JSON.stringify(backup), "merge")
    await settle()
    expect(await other.getSource(id)).toBe("base!")
  })

  it("keeps stars set after everything is deleted", async () => {
    const name = `delete-all-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    await eos.setStarred(await eos.createDiagram({ source: "old" }), true)
    await eos.deleteAll()
    const id = await eos.createDiagram({ source: "new" })
    await eos.setStarred(id, true)
    await settle()
    const later = await Eos.create({ dbName: name, seed: false })
    await later.renameDiagram(id, "Renamed") // rewrites the index row from the saved stars
    expect((await later.listDiagrams())[0]?.starred).toBe(1)
  })

  it("opens a diagram whole while another tab compacts it", async () => {
    const name = `open-mid-compact-${n++}`
    const one = await Eos.create({ dbName: name, seed: false })
    const id = await one.createDiagram({ source: "a" })
    for (const s of ["ab", "abc"]) await one.setSource(id, s) // logged, not yet compacted
    await settle()
    const doc = (await one.openDiagram(id)).doc
    const two = await Eos.create({ dbName: name, seed: false })
    // The other tab compacts just as this one has read the snapshot, before it reads the log.
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["get"]>) {
      const request = get.apply(this, args)
      if (this.name === "snapshots" && args[0] === id && this.transaction.mode === "readonly") {
        IDBObjectStore.prototype.get = get
        request.addEventListener("success", () => void compact(dbOf(one), id, doc))
      }
      return request
    }
    try {
      expect(await two.getSource(id)).toBe("abc")
    } finally {
      IDBObjectStore.prototype.get = get
    }
  })

  it("keeps changes another tab saved that this one hasn't heard of when compacting", async () => {
    const db = await openEosDB(`compact-${n++}`)
    const id = "d"
    const here = new LoroDoc()
    here.getText("source").insert(0, "base")
    here.commit()
    await compact(db, id, here)
    // Another tab, whose updates never reach this one: it compacts, then logs one more.
    const there = new LoroDoc()
    there.importBatch([(await db.get("snapshots", id))!.bytes])
    there.getText("source").insert(4, " one")
    there.commit()
    await compact(db, id, there)
    const before = there.version()
    there.getText("source").insert(8, " two")
    there.commit()
    await db.add("updates", { id, bytes: there.export({ mode: "update", from: before }), at: Date.now() })
    await compact(db, id, here)
    expect((await loadDoc(db, id)).getText("source").toString()).toBe("base one two")
  })

  it("saves a new diagram whole or not at all", async () => {
    const eos = await fresh()
    const restore = failWrites("put", "diagrams")
    try {
      await expect(eos.createDiagram({ source: "x" })).rejects.toThrow()
    } finally {
      restore()
    }
    expect(await dbOf(eos).count("snapshots")).toBe(0)
  })

  it("imports a backup's diagram whole or not at all", async () => {
    const a = await fresh()
    const id = await a.createDiagram({ source: "x" })
    const backup = await a.exportBackup()
    const eos = await fresh()
    const restore = failWrites("put", "diagrams")
    try {
      await expect(eos.importBackup(backup, "merge")).rejects.toThrow()
    } finally {
      restore()
    }
    expect(await dbOf(eos).get("snapshots", id)).toBeUndefined()
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

  it("hears every keystroke in a tab that opens the diagram while another tab's typing is being saved", async () => {
    const name = `open-mid-write-${n++}`
    const one = await Eos.create({ dbName: name, seed: false })
    const id = await one.createDiagram({ source: "" })
    const two = await Eos.create({ dbName: name, seed: false })
    const a = await editor(one, id)
    for (let i = 0; i < 30; i++) a.type(i, "a")
    // The other tab hears some of those keystrokes before they're saved, then opens the diagram.
    await new Promise((r) => setTimeout(r, 0))
    await two.getSource(id)
    await settle()
    a.type(30, "Z")
    await settle()
    expect(await two.getSource(id)).toBe(a.state.text)
  })

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

  it("starts a fresh burst after an undo that found its text already gone", async () => {
    const name = `gone-${n++}`
    const one = await Eos.create({ dbName: name, seed: false })
    const id = await one.createDiagram({ source: "one\ntwo" })
    const two = await Eos.create({ dbName: name, seed: false })
    const a = await editor(one, id)
    const b = await editor(two, id)
    a.type(3, "x")
    await settle()
    b.binding.edit([{ from: 3, to: 4, insert: "" }]) // the other tab deletes the "x"
    await settle()
    expect(await one.undo(id)).toBe(false)
    await new Promise((r) => setTimeout(r, 900)) // a pause, so the next keystroke starts a new burst
    a.type(0, "z")
    await settle()
    b.type(b.binding.text().length, "b") // splits the burst into two steps
    await settle()
    a.type(1, "w")
    await settle()
    expect(await one.undo(id)).toBe(true)
    expect(await one.getSource(id)).toBe("one\ntwob")
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

describe("library events and reads", () => {
  /** Long enough for every tab to hear the others, and for typing's index refresh (300ms) to run. */
  const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms))
  const openCount = (eos: Eos) => (eos as unknown as { open: Map<string, unknown> }).open.size
  /** How many times each topic fires on `eos`. */
  function count(eos: Eos, ...topics: Parameters<Eos["subscribe"]>[0][]) {
    const counts: Record<string, number> = Object.fromEntries(topics.map((t) => [t, 0]))
    for (const t of topics) eos.subscribe(t, () => counts[t]!++)
    return counts
  }
  async function tabs(diagrams: number) {
    const name = `events-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const ids: string[] = []
    for (let i = 0; i < diagrams; i++) ids.push(await eos.createDiagram({ title: `d${i}`, tags: ["work/x", "home"] }))
    const other = await Eos.create({ dbName: name, seed: false })
    // Other tests' tabs share the channel; let their last messages land first.
    await settle(400)
    return { name, eos, other, ids }
  }

  it("sends one library event, here and in other tabs, for a change to many diagrams", async () => {
    const { eos, other, ids } = await tabs(5)
    const here = count(eos, "library")
    const there = count(other, "library")
    await eos.renameTag("work", "job")
    await settle()
    expect([here.library, there.library]).toEqual([1, 1])
    await eos.deleteTag("home")
    await settle()
    expect([here.library, there.library]).toEqual([2, 2])
    await eos.deleteDiagram(ids)
    await settle()
    expect([here.library, there.library]).toEqual([3, 3])
    expect((await other.listDiagrams({ deleted: true })).every((r) => r.tags.join() === "job/x")).toBe(true)
  })

  it("leaves the library alone while another tab types, until its index row changes", async () => {
    const { eos, other, ids } = await tabs(1)
    const id = ids[0]!
    const counts = count(other, "library", `diagram:${id}`)
    const binding = await eos.bindSource(id)
    for (const ch of "abc") binding.edit([{ from: 0, to: 0, insert: ch }])
    await settle()
    expect(counts).toEqual({ library: 0, [`diagram:${id}`]: 3 })
    await settle(400)
    expect(counts.library).toBe(1)
    // Stars and tag emoji live in the workspace, so its changes do refresh the library.
    await eos.setTagEmoji("home", "🏠")
    await settle()
    expect(counts.library).toBe(2)
    expect((await other.listTags()).find((t) => t.path === "home")?.emoji).toBe("🏠")
  })

  it("reads the rows once until they change, here or in another tab", async () => {
    const { eos, other, ids } = await tabs(3)
    const [a, b, c] = ids as [string, string, string]
    const first = await eos.listDiagrams({ sort: "title" })
    // Shared by every list, and the same objects until a row changes.
    expect(await eos.listDiagrams({ sort: "title" })).toEqual(first)
    expect((await eos.listDiagrams({ sort: "title" }))[0]).toBe(first[0])
    await eos.renameDiagram(a, "renamed")
    const renamed = await eos.listDiagrams({ sort: "title" })
    expect(renamed.find((r) => r.id === a)?.title).toBe("renamed")
    expect(renamed.find((r) => r.id === b)).toBe(first.find((r) => r.id === b))
    expect(await eos.counts()).toEqual({ all: 3, starred: 0, deleted: 0 })
    // Changes another tab makes come in with its index and close messages.
    await other.deleteDiagram(b)
    await settle()
    expect(await eos.counts()).toEqual({ all: 2, starred: 0, deleted: 1 })
    await other.purge(b)
    await other.setStarred(c, true)
    await settle()
    expect(await eos.counts()).toEqual({ all: 2, starred: 1, deleted: 0 })
    expect((await eos.listTags()).find((t) => t.path === "home")?.count).toBe(2)
  })

  it("searches the same as an index built for each query", async () => {
    const eos = await fresh()
    const words = ["checkout", "payment", "billing", "invoice", "auth", "login", "queue", "worker"]
    for (let i = 0; i < 40; i++) {
      const pick = (k: number) => words[(i * k) % words.length]!
      await eos.createDiagram({
        title: `${pick(3)} ${pick(5)} ${i}`,
        source: `flowchart TD\n  A[${pick(7)}] --> B[${pick(2)}]\n`,
        tags: [`t${i % 3}`],
      })
    }
    const { create, insertMultiple, search } = await import("@orama/orama")
    /** What listDiagrams did before the index was kept: build one over just these rows. */
    const reference = async (rows: DiagramIndexRow[], term: string) => {
      const db = create({ schema: { id: "string", title: "string", source: "string" } as const })
      await insertMultiple(
        db,
        rows.map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview }))
      )
      const result = await search(db, {
        term,
        properties: ["title", "source"],
        boost: { title: 3 },
        tolerance: term.length > 3 ? 1 : 0,
        limit: rows.length,
      })
      return result.hits.map((h) => h.document.id)
    }
    const all = await eos.listDiagrams()
    for (const q of ["checkout", "chekout", "bill", "a", "auth login", "worker 7", "nothing"]) {
      expect((await eos.listDiagrams({ query: q })).map((r) => r.id)).toEqual(await reference(all, q))
      // Filtered, it finds the same diagrams.
      const tagged = all.filter((r) => r.tags.includes("t1"))
      expect(new Set((await eos.listDiagrams({ query: q, tags: ["t1"] })).map((r) => r.id))).toEqual(new Set(await reference(tagged, q)))
    }
    // Kept until the library changes.
    const id = await eos.createDiagram({ title: "zebra crossing" })
    expect((await eos.listDiagrams({ query: "zebra" })).map((r) => r.id)).toEqual([id])
  })

  it("retags and backs up diagrams without opening them, and other tabs see the change", async () => {
    const { name, eos, other, ids } = await tabs(3)
    await other.getSource(ids[0]!) // open in the other tab
    const agent: Actor = { kind: "agent", tool: "update_tag", changes: ["tags"] }
    await eos.renameTag("work", "job", agent)
    expect(openCount(eos)).toBe(0)
    await settle()
    expect((await other.getDiagram(ids[0]!))?.meta.tags).toEqual(["job/x", "home"])
    // Saved, credited to the agent, and on nobody's undo stack.
    const later = await Eos.create({ dbName: name, seed: false })
    const d = (await later.getDiagram(ids[1]!))!
    expect(d.meta.tags).toEqual(["job/x", "home"])
    expect((await later.history(ids[1]!))[0]?.actor).toEqual(agent)
    expect(await later.canUndo(ids[1]!, "agent")).toEqual({ canUndo: false, canRedo: false })
    const fresh2 = await Eos.create({ dbName: name, seed: false })
    const backup = JSON.parse(await fresh2.exportBackup()) as { diagrams: unknown[] }
    expect(backup.diagrams).toHaveLength(3)
    expect(openCount(fresh2)).toBe(0)
  })

  it("keeps both of two tag changes made at once to a diagram that isn't open", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ title: "A" })
    await Promise.all([eos.addTags(id, ["x"]), eos.addTags(id, ["y"])])
    expect((await eos.listDiagrams())[0]?.tags).toEqual(["x", "y"])
    expect((await eos.getDiagram(id))?.meta.tags).toEqual(["x", "y"])
  })

  /** Lets `k` microtasks run, to land a second change at each point in the first one. */
  const ticks = async (k: number) => {
    for (let i = 0; i < k; i++) await Promise.resolve()
  }

  it("never brings back a diagram purged while a tag change to it was being saved", async () => {
    const back: number[] = []
    for (let k = 0; k < 80; k += 2) {
      const eos = await fresh()
      const id = await eos.createDiagram({ title: "A", tags: ["t"] })
      await eos.deleteDiagram(id)
      const add = eos.addTags(id, ["u"]).catch(() => {})
      await ticks(k)
      await eos.purge(id)
      await add
      if ((await eos.listDiagrams({ includeDeleted: true })).length) back.push(k)
    }
    expect(back).toEqual([])
  })

  it("keeps another tab's delete made while a tag change was being saved", async () => {
    const undeleted: string[] = []
    for (let k = 0; k < 80; k += 2)
      for (const open of [false, true]) {
        const name = `race-${n++}`
        const a = await Eos.create({ dbName: name, seed: false })
        const b = await Eos.create({ dbName: name, seed: false })
        const id = await a.createDiagram({ title: "A" })
        if (open) await a.getSource(id)
        const add = a.addTags(id, ["x"])
        await ticks(k)
        await b.deleteDiagram(id)
        await add
        if (!(await b.listDiagrams({ includeDeleted: true }))[0]?.deletedAt) undeleted.push(`${k} ${open ? "open" : "closed"}`)
      }
    expect(undeleted).toEqual([])
  })

  it("renames a tag on the diagrams still there when one is purged partway", async () => {
    const eos = await fresh()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(await eos.createDiagram({ title: `d${i}`, tags: ["work"] }))
    await eos.setTagEmoji("work", "💼")
    await eos.deleteDiagram(ids[1]!)
    const renamed = eos.renameTag("work", "job")
    await eos.purge(ids[1]!)
    await renamed
    expect((await eos.listDiagrams()).map((r) => r.tags)).toEqual([["job"], ["job"]])
    expect((await eos.listTags()).map((t) => [t.path, t.emoji])).toEqual([["job", "💼"]])
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

  it("rejects snapshots Loro can't read before replacing anything", async () => {
    const eos = await fresh()
    await eos.createDiagram({ title: "Keep me" })
    const junk = toBase64(new TextEncoder().encode("not a loro snapshot"))
    await expect(eos.importBackup(JSON.stringify({ v: 1, diagrams: [{ id: "x", snapshot: junk }] }), "replace")).rejects.toThrow(/damaged/)
    await expect(eos.importBackup(JSON.stringify({ v: 1, workspace: junk, diagrams: [] }), "replace")).rejects.toThrow(/damaged/)
    expect((await eos.listDiagrams()).map((d) => d.title)).toEqual(["Keep me"])
  })

  it("brings in the theme but never agent settings", async () => {
    const eos = await fresh()
    const backup = { v: 1, diagrams: [], settings: { theme: { mode: "dark" }, agent: { confirmDestructive: false, webmcpEnabled: false } } }
    await eos.importBackup(JSON.stringify(backup), "merge")
    expect(eos.getSettings()).toEqual({
      theme: { mode: "dark", customCss: null, diagramCss: null },
      agent: { webmcpEnabled: true, confirmDestructive: true },
    })
    expect(JSON.parse(await eos.exportBackup()).settings).toEqual({ theme: eos.getSettings().theme })
  })

  it("keeps stars and tag emoji when replacing the library with its own backup", async () => {
    const name = `replace-own-${n++}`
    const eos = await Eos.create({ dbName: name, seed: false })
    const id = await eos.createDiagram({ source: "x", tags: ["work"] })
    await eos.setStarred(id, true)
    await eos.setTagEmoji("work", "🔥")
    await eos.importBackup(await eos.exportBackup(), "replace")
    expect((await eos.listDiagrams())[0]?.starred).toBe(1)
    expect((await eos.listTags()).map((t) => t.emoji)).toEqual(["🔥"])
    await new Promise((r) => setTimeout(r, 50))
    const later = await Eos.create({ dbName: name, seed: false })
    expect((await later.listTags()).map((t) => t.emoji)).toEqual(["🔥"])
    await later.renameDiagram(id, "Renamed") // rewrites the index row from the saved stars
    expect((await later.listDiagrams())[0]?.starred).toBe(1)
  })

  it("brings back only the stars of diagrams the backup has when replacing the library", async () => {
    const eos = await fresh()
    const id = await eos.createDiagram({ source: "x" })
    await eos.setStarred(id, true)
    // A star whose diagram is gone, as an older version could leave behind.
    const { workspace } = eos as unknown as { workspace: { doc: LoroDoc; starred: LoroMap } }
    workspace.starred.set("no-such-diagram", true)
    workspace.doc.commit()
    await eos.importBackup(await eos.exportBackup(), "replace")
    const saved = LoroDoc.fromSnapshot(fromBase64(JSON.parse(await eos.exportBackup()).workspace))
    expect(saved.getMap("starred").toJSON()).toEqual({ [id]: true })
  })

  it("keeps whether a diagram is deleted when merging a backup, whether it's open or not", async () => {
    for (const open of [true, false]) {
      const eos = await fresh()
      const id = await eos.createDiagram({ source: "x" })
      await eos.deleteDiagram(id)
      const backup = await eos.exportBackup() // deleted then, restored since
      await eos.restoreDiagram(id)
      if (open) await eos.getSource(id)
      await eos.importBackup(backup, "merge")
      expect((await eos.listDiagrams()).map((r) => r.id)).toEqual([id])
    }
  })

  /** A backup of one diagram whose doc `tamper` has changed. */
  async function tamperedBackup(tamper: (doc: LoroDoc) => void) {
    const a = await fresh()
    const id = await a.createDiagram({ title: "Tampered", source: "a" })
    const backup = JSON.parse(await a.exportBackup())
    const doc = new LoroDoc()
    doc.import(fromBase64(backup.diagrams[0].snapshot))
    tamper(doc)
    backup.diagrams[0].snapshot = toBase64(doc.export({ mode: "snapshot" }))
    return { id, backup: JSON.stringify(backup) }
  }

  it("keeps only the string tags a backup's diagram carries", async () => {
    const { id, backup } = await tamperedBackup((doc) => {
      doc.getMap("meta").set("tags", ["ok", 1, { x: 1 }, ["nested"]])
      doc.commit()
    })
    const eos = await fresh()
    await eos.importBackup(backup, "merge")
    expect((await eos.getDiagram(id))?.meta.tags).toEqual(["ok"])
    expect((await eos.listDiagrams({ tags: ["ok"] })).map((d) => d.id)).toEqual([id])
  })

  it("reads commit messages that aren't an actor as the person's", async () => {
    const { id, backup } = await tamperedBackup((doc) => {
      for (const message of ["null", "[]", '{"kind":"system","reason":{"x":1}}', '{"kind":"agent","tool":7}', "free-form"]) {
        doc.getText("source").insert(0, "x")
        doc.commit({ message })
      }
    })
    const eos = await fresh()
    await eos.importBackup(backup, "merge")
    expect((await eos.history(id)).map((e) => e.actor)).toEqual([{ kind: "user" }])
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

  it("refuses a link that inflates past the size cap or carries a huge title", async () => {
    const deflate = async (json: object) => {
      const bytes = new TextEncoder().encode(JSON.stringify(json))
      const out = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))
      return toBase64(new Uint8Array(await new Response(out).arrayBuffer()), "base64url")
    }
    const bomb = await deflate({ v: 1, title: "T", source: "a".repeat(5_000_000) })
    expect(bomb.length).toBeLessThan(32_000)
    expect(await decodeShare(bomb)).toBeNull()
    expect(await decodeShare(await deflate({ v: 1, title: "T".repeat(1_001), source: "a" }))).toBeNull()
    const largest = { title: "T".repeat(1_000), source: "a".repeat(50_000) }
    expect(await decodeShare(await encodeShare(largest))).toEqual({ ...largest, tags: [] })
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
