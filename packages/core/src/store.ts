import { LoroDoc, type LoroMap, UndoManager } from "loro-crdt"

import { openEosDB, WORKSPACE_ID, type Database } from "./db"
import {
  commit,
  compact,
  decodeVersion,
  deleteDocData,
  encodeVersion,
  historyOf,
  lastChangeAt,
  loadDoc,
  metaOf,
  persistDoc,
  setTags,
  sourceOf,
  type DiagramDoc,
} from "./docs"
import { SAMPLES } from "./samples"
import type { SharePayload } from "./share"
import { buildTagTree, normalizeTag, normalizeTags, tagMatches, tagPrefixes } from "./tags"
import type {
  Actor,
  AppSettings,
  DiagramId,
  DiagramIndexRow,
  DiagramSnapshot,
  HistoryEntry,
  LibraryFilter,
  TagRecord,
} from "./types"

const USER: Actor = { kind: "user" }

export const DEFAULT_SETTINGS: AppSettings = {
  theme: { customCss: null },
  agent: { webmcpEnabled: true, confirmDestructive: true },
}

type Topic = "library" | "settings" | `diagram:${string}`
type Listener = () => void

interface OpenDiagram extends DiagramDoc {
  undo: UndoManager
}

interface Workspace {
  doc: LoroDoc
  starred: LoroMap
  tagEmoji: LoroMap
}

interface SyncMessage {
  type: "update" | "index" | "settings"
  id?: DiagramId
  bytes?: Uint8Array
}

export class Eos {
  private listeners = new Map<Topic, Set<Listener>>()
  private open = new Map<DiagramId, Promise<OpenDiagram>>()
  private channel: BroadcastChannel | null = null
  private settingsCache: AppSettings = DEFAULT_SETTINGS

  private db: Database
  private workspace: Workspace

  private constructor(db: Database, workspace: Workspace) {
    this.db = db
    this.workspace = workspace
  }

  static async create(options: { dbName?: string; seed?: boolean } = {}): Promise<Eos> {
    const db = await openEosDB(options.dbName)
    const doc = await loadDoc(db, WORKSPACE_ID)
    const workspace = { doc, starred: doc.getMap("starred"), tagEmoji: doc.getMap("tagEmoji") }
    const eos = new Eos(db, workspace)
    persistDoc(db, WORKSPACE_ID, doc, (bytes) => eos.broadcast({ type: "update", id: WORKSPACE_ID, bytes }))
    eos.settingsCache = { ...DEFAULT_SETTINGS, ...((await db.get("settings", "app")) ?? {}) }
    eos.listenToOtherTabs()
    if (options.seed !== false && (await db.count("diagrams")) === 0) {
      for (const s of SAMPLES) await eos.createDiagram(s, { kind: "system", reason: "seed" })
    }
    return eos
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  subscribe(topic: Topic, listener: Listener): () => void {
    let set = this.listeners.get(topic)
    if (!set) this.listeners.set(topic, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }

  private emit(...topics: Topic[]) {
    for (const t of topics) this.listeners.get(t)?.forEach((l) => l())
  }

  // ── Library ────────────────────────────────────────────────────────────────

  async listDiagrams(filter: LibraryFilter = {}): Promise<DiagramIndexRow[]> {
    let rows = await this.db.getAll("diagrams")
    rows = rows.filter((r) => (filter.includeDeleted ? true : !r.deletedAt))
    if (filter.starred) rows = rows.filter((r) => r.starred === 1)
    for (const tag of filter.tags ?? []) rows = rows.filter((r) => r.tags.some((t) => tagMatches(t, tag)))
    const q = filter.query?.trim().toLowerCase()
    if (q) rows = rows.filter((r) => r.titleKey.includes(q) || r.sourcePreview.toLowerCase().includes(q))
    const sort = filter.sort ?? "modified"
    rows.sort((a, b) =>
      sort === "title"
        ? a.titleKey.localeCompare(b.titleKey)
        : sort === "created"
          ? b.createdAt - a.createdAt
          : b.updatedAt - a.updatedAt,
    )
    return rows
  }

  async listTags(): Promise<TagRecord[]> {
    const rows = await this.db.getAll("diagrams")
    return buildTagTree(rows, this.workspace.tagEmoji.toJSON() as Record<string, string | null>)
  }

  async counts(): Promise<{ all: number; starred: number }> {
    const rows = (await this.db.getAll("diagrams")).filter((r) => !r.deletedAt)
    return { all: rows.length, starred: rows.filter((r) => r.starred).length }
  }

  // ── Diagrams ───────────────────────────────────────────────────────────────

  async getDiagram(id: DiagramId): Promise<DiagramSnapshot | null> {
    const row = await this.db.get("diagrams", id)
    if (!row) return null
    const d = await this.openDiagram(id)
    return {
      id,
      meta: metaOf(d),
      source: sourceOf(d),
      starred: row.starred === 1,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }
  }

  async createDiagram(
    input: { title?: string; source?: string; tags?: string[] } = {},
    actor: Actor = USER,
  ): Promise<DiagramId> {
    const id = crypto.randomUUID()
    const doc = new LoroDoc()
    doc.setRecordTimestamp(true)
    const meta = doc.getMap("meta")
    meta.set("title", input.title?.trim() || "Untitled")
    meta.set("createdAt", Date.now())
    setTags(meta, normalizeTags(input.tags ?? []))
    doc.getText("source").insert(0, input.source ?? "flowchart TD\n  A[Start] --> B[End]\n")
    commit(doc, actor)
    await this.db.put("snapshots", { id, bytes: doc.export({ mode: "snapshot" }), savedAt: Date.now() })
    await this.writeIndex(id, doc)
    this.emit("library")
    this.broadcast({ type: "index", id })
    return id
  }

  async renameDiagram(id: DiagramId, title: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => d.meta.set("title", title.trim() || "Untitled"))
  }

  async duplicateDiagram(id: DiagramId, title?: string, actor: Actor = USER): Promise<DiagramId> {
    const d = await this.openDiagram(id)
    const meta = metaOf(d)
    return this.createDiagram({ title: title ?? `${meta.title} copy`, source: sourceOf(d), tags: meta.tags }, actor)
  }

  async deleteDiagram(id: DiagramId) {
    await this.patchIndex(id, { deletedAt: Date.now() })
  }

  async restoreDiagram(id: DiagramId) {
    await this.patchIndex(id, { deletedAt: undefined })
  }

  // ── Source ─────────────────────────────────────────────────────────────────

  async getSource(id: DiagramId, version?: string): Promise<string> {
    const d = await this.openDiagram(id)
    if (!version) return sourceOf(d)
    return d.doc.forkAt(decodeVersion(version)).getText("source").toString()
  }

  async setSource(id: DiagramId, source: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => d.text.update(source))
  }

  // ── History ────────────────────────────────────────────────────────────────

  async undo(id: DiagramId): Promise<boolean> {
    const d = await this.openDiagram(id)
    const done = d.undo.undo()
    if (done) await this.afterChange(id, d)
    return done
  }

  async redo(id: DiagramId): Promise<boolean> {
    const d = await this.openDiagram(id)
    const done = d.undo.redo()
    if (done) await this.afterChange(id, d)
    return done
  }

  async canUndo(id: DiagramId): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const d = await this.openDiagram(id)
    return { canUndo: d.undo.canUndo(), canRedo: d.undo.canRedo() }
  }

  async history(id: DiagramId, limit?: number): Promise<HistoryEntry[]> {
    return historyOf((await this.openDiagram(id)).doc, limit)
  }

  async version(id: DiagramId): Promise<string> {
    return encodeVersion((await this.openDiagram(id)).doc)
  }

  async restoreVersion(id: DiagramId, version: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => d.doc.revertTo(decodeVersion(version)))
  }

  // ── Organisation ───────────────────────────────────────────────────────────

  async setStarred(id: DiagramId, starred: boolean, actor: Actor = USER) {
    if (starred) this.workspace.starred.set(id, true)
    else this.workspace.starred.delete(id)
    commit(this.workspace.doc, actor)
    await this.patchIndex(id, { starred: starred ? 1 : 0 })
  }

  async addTags(id: DiagramId, tags: string[], actor: Actor = USER) {
    await this.mutate(id, actor, (d) => setTags(d.meta, normalizeTags([...metaOf(d).tags, ...tags])))
  }

  async removeTags(id: DiagramId, tags: string[], actor: Actor = USER) {
    const drop = new Set(normalizeTags(tags))
    await this.mutate(id, actor, (d) => setTags(d.meta, metaOf(d).tags.filter((t) => !drop.has(t))))
  }

  async renameTag(from: string, to: string, actor: Actor = USER) {
    const src = normalizeTag(from)
    const dst = normalizeTag(to)
    if (!src || !dst) return
    const rows = await this.db.getAllFromIndex("diagrams", "byTag", src)
    for (const row of rows) {
      await this.mutate(row.id, actor, (d) =>
        setTags(d.meta, normalizeTags(metaOf(d).tags.map((t) => (tagMatches(t, src) ? dst + t.slice(src.length) : t)))),
      )
    }
  }

  /** Removes a tag (and any tags nested under it) from every diagram. */
  async deleteTag(path: string, actor: Actor = USER): Promise<number> {
    const tag = normalizeTag(path)
    if (!tag) return 0
    const rows = await this.db.getAllFromIndex("diagrams", "byTag", tag)
    for (const row of rows) {
      await this.mutate(row.id, actor, (d) => setTags(d.meta, metaOf(d).tags.filter((t) => !tagMatches(t, tag))))
    }
    for (const key of this.workspace.tagEmoji.keys()) if (tagMatches(key, tag)) this.workspace.tagEmoji.delete(key)
    commit(this.workspace.doc, actor)
    this.emit("library")
    return rows.length
  }

  async setTagEmoji(path: string, emoji: string | null, actor: Actor = USER) {
    const tag = normalizeTag(path)
    if (!tag) return
    if (emoji) this.workspace.tagEmoji.set(tag, emoji)
    else this.workspace.tagEmoji.delete(tag)
    commit(this.workspace.doc, actor)
    this.emit("library")
  }

  // ── Settings & data ────────────────────────────────────────────────────────

  getSettings(): AppSettings {
    return this.settingsCache
  }

  async updateSettings(patch: Partial<AppSettings>) {
    this.settingsCache = {
      theme: { ...this.settingsCache.theme, ...patch.theme },
      agent: { ...this.settingsCache.agent, ...patch.agent },
    }
    await this.db.put("settings", this.settingsCache, "app")
    this.emit("settings")
    this.broadcast({ type: "settings" })
  }

  async storageUsage(): Promise<{ usage: number; quota: number; persisted: boolean }> {
    const est = (await navigator.storage?.estimate?.()) ?? {}
    const persisted = (await navigator.storage?.persisted?.()) ?? false
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted }
  }

  async requestPersistence(): Promise<boolean> {
    return (await navigator.storage?.persist?.()) ?? false
  }

  async exportBackup(): Promise<string> {
    const rows = await this.db.getAll("diagrams")
    const diagrams = []
    for (const row of rows) {
      const d = await this.openDiagram(row.id)
      diagrams.push({ id: row.id, deletedAt: row.deletedAt, snapshot: bytesToBase64(d.doc.export({ mode: "snapshot" })) })
    }
    return JSON.stringify({
      v: 1,
      settings: this.settingsCache,
      workspace: bytesToBase64(this.workspace.doc.export({ mode: "snapshot" })),
      diagrams,
    })
  }

  async importBackup(data: string, mode: "merge" | "replace") {
    const backup = JSON.parse(data) as {
      v: number
      settings?: AppSettings
      workspace?: string
      diagrams: { id: string; deletedAt?: number; snapshot: string }[]
    }
    if (backup.v !== 1) throw new Error("Unsupported backup version")
    if (mode === "replace") await this.deleteAll({ reseed: false })
    if (backup.workspace) this.workspace.doc.import(base64ToBytes(backup.workspace))
    for (const item of backup.diagrams) {
      const bytes = base64ToBytes(item.snapshot)
      if (this.open.has(item.id)) {
        const d = await this.openDiagram(item.id)
        d.doc.import(bytes)
        await this.afterChange(item.id, d)
      } else {
        const existing = await loadDoc(this.db, item.id)
        existing.import(bytes)
        await this.db.put("snapshots", { id: item.id, bytes: existing.export({ mode: "snapshot" }), savedAt: Date.now() })
        await this.writeIndex(item.id, existing, item.deletedAt)
      }
    }
    if (backup.settings) await this.updateSettings(backup.settings)
    this.emit("library")
  }

  async deleteAll({ reseed = false } = {}) {
    for (const [id, p] of this.open) (await p).dispose(), this.open.delete(id)
    const tx = this.db.transaction(["snapshots", "updates", "diagrams", "thumbnails"], "readwrite")
    await Promise.all([
      tx.objectStore("snapshots").clear(),
      tx.objectStore("updates").clear(),
      tx.objectStore("diagrams").clear(),
      tx.objectStore("thumbnails").clear(),
    ])
    await tx.done
    for (const key of this.workspace.starred.keys()) this.workspace.starred.delete(key)
    for (const key of this.workspace.tagEmoji.keys()) this.workspace.tagEmoji.delete(key)
    commit(this.workspace.doc, { kind: "system", reason: "delete-all" })
    if (reseed) for (const s of SAMPLES) await this.createDiagram(s, { kind: "system", reason: "seed" })
    this.emit("library")
  }

  /** Imports a shared diagram, or returns the existing one if it's byte-for-byte the same. */
  async importShare(payload: SharePayload): Promise<DiagramId> {
    const existing = await this.findIdentical(payload.title, payload.source)
    if (existing) return existing
    return this.createDiagram(payload, { kind: "import", source: "share-link" })
  }

  private async findIdentical(title: string, source: string): Promise<DiagramId | null> {
    const candidates = (await this.db.getAll("diagrams")).filter(
      (r) => !r.deletedAt && r.title === (title.trim() || "Untitled") && source.startsWith(r.sourcePreview),
    )
    for (const row of candidates) if ((await this.getSource(row.id)) === source) return row.id
    return null
  }

  /** Permanently removes soft-deleted diagrams. */
  async purge(id: DiagramId) {
    this.open.get(id)?.then((d) => d.dispose())
    this.open.delete(id)
    await deleteDocData(this.db, id)
    this.emit("library")
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  openDiagram(id: DiagramId): Promise<OpenDiagram> {
    let p = this.open.get(id)
    if (!p) {
      p = (async () => {
        const doc = await loadDoc(this.db, id)
        if (doc.oplogVersion().length() === 0 && !(await this.db.get("diagrams", id))) {
          throw new Error(`Diagram ${id} not found`)
        }
        const undo = new UndoManager(doc, { mergeInterval: 800, maxUndoSteps: 200 })
        const stop = persistDoc(this.db, id, doc, (bytes) => this.broadcast({ type: "update", id, bytes }))
        return {
          id,
          doc,
          text: doc.getText("source"),
          meta: doc.getMap("meta"),
          undo,
          dispose: () => {
            stop()
            void compact(this.db, id, doc)
          },
        }
      })()
      this.open.set(id, p)
      p.catch(() => this.open.delete(id))
    }
    return p
  }

  private async mutate(id: DiagramId, actor: Actor, fn: (d: OpenDiagram) => void) {
    const d = await this.openDiagram(id)
    d.undo.groupStart()
    try {
      fn(d)
      commit(d.doc, actor)
    } finally {
      d.undo.groupEnd()
    }
    await this.afterChange(id, d)
  }

  private async afterChange(id: DiagramId, d: DiagramDoc) {
    const row = await this.db.get("diagrams", id)
    await this.writeIndex(id, d.doc, row?.deletedAt)
    this.emit("library", `diagram:${id}`)
    this.broadcast({ type: "index", id })
  }

  private async writeIndex(id: DiagramId, doc: LoroDoc, deletedAt?: number) {
    const d = { text: doc.getText("source"), meta: doc.getMap("meta") }
    const meta = metaOf(d)
    const source = sourceOf(d)
    const row: DiagramIndexRow = {
      id,
      title: meta.title,
      tags: meta.tags,
      tagPrefixes: tagPrefixes(meta.tags),
      createdAt: meta.createdAt,
      updatedAt: lastChangeAt(doc) || Date.now(),
      titleKey: meta.title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase(),
      starred: this.workspace.starred.get(id) ? 1 : 0,
      sourcePreview: source.slice(0, 200),
      ...(deletedAt ? { deletedAt } : {}),
    }
    await this.db.put("diagrams", row)
  }

  private async patchIndex(id: DiagramId, patch: Partial<DiagramIndexRow>) {
    const row = await this.db.get("diagrams", id)
    if (!row) throw new Error(`Diagram ${id} not found`)
    const next = { ...row, ...patch }
    if (patch.deletedAt === undefined && "deletedAt" in patch) delete next.deletedAt
    await this.db.put("diagrams", next)
    this.emit("library", `diagram:${id}`)
    this.broadcast({ type: "index", id })
  }

  private broadcast(msg: SyncMessage) {
    this.channel?.postMessage(msg)
  }

  private listenToOtherTabs() {
    if (typeof BroadcastChannel === "undefined") return
    this.channel = new BroadcastChannel("eos")
    this.channel.onmessage = async ({ data }: MessageEvent<SyncMessage>) => {
      if (data.type === "settings") {
        this.settingsCache = { ...DEFAULT_SETTINGS, ...((await this.db.get("settings", "app")) ?? {}) }
        this.emit("settings")
      } else if (data.type === "update" && data.id && data.bytes) {
        if (data.id === WORKSPACE_ID) this.workspace.doc.import(data.bytes)
        else if (this.open.has(data.id)) (await this.openDiagram(data.id)).doc.import(data.bytes)
        this.emit("library", `diagram:${data.id}`)
      } else if (data.type === "index") {
        this.emit("library", `diagram:${data.id}`)
      }
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function base64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
