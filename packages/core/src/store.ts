import { diffChars } from "diff"
import { type Frontiers, LoroDoc, type LoroMap, type LoroText, UndoManager, type Value } from "loro-crdt"
import * as z from "zod/mini"

import { fromBase64, toBase64 } from "./base64"
import { openEosDB, WORKSPACE_ID, type Database, type OpenHooks } from "./db"
import {
  actorOrigin,
  commit,
  compact,
  decodeVersion,
  DETAILS,
  deleteDocData,
  encodeVersion,
  historyOf,
  lastChangeAt,
  loadDoc,
  metaOf,
  persistDoc,
  setTags,
  sourceOf,
  updateRow,
  type DiagramDoc,
  type Persisted,
  type RowBuilder,
} from "./docs"
import { SAMPLES } from "./samples"
import { searchIndex, type Search } from "./search"
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
  SourceBinding,
  TagRecord,
  TextChange,
} from "./types"

const USER: Actor = { kind: "user" }
/** Origin of keystrokes from a bound editor. Starts with "user", so undo treats them as the person's. */
const EDITOR_ORIGIN = "user:editor"
/** Keystrokes closer together than this are one undo step; it's also how long the library index lags typing. */
const MERGE_MS = 800
/** How long the library index waits for typing to pause. */
const INDEX_MS = 300

export const DEFAULT_SETTINGS: AppSettings = {
  theme: { mode: "system", customCss: null, diagramCss: null },
  agent: { webmcpEnabled: true, confirmDestructive: true },
}

type Topic = "library" | "settings" | `diagram:${string}`
type Listener = () => void

interface OpenDiagram extends DiagramDoc {
  /** The person's ⌘Z stack: skips agent edits, which stay in history to restore from. */
  undo: UndoManager
  /** An agent's own undo stack: only agent edits. */
  agentUndo: UndoManager
  /**
   * Which burst of typing each step on `undo` belongs to (see openDiagram). While an
   * undo or redo runs, `stepping` is the burst of the steps it moves, which they keep.
   */
  burst: { count: number; lastEdit: number; stepping: Value | undefined }
  persisted: Persisted
}

/** What a change made through mutate works on: an open diagram, or a copy loaded for the change. */
type Editable = Pick<DiagramDoc, "id" | "doc" | "text" | "meta">

/**
 * One diagram, or several. A change to several is one batch (one library event, one index
 * message to other tabs) and skips any that are missing; a single missing one throws.
 */
export type Ids = DiagramId | DiagramId[]

/** Whose undo stack to use. */
export type UndoScope = "user" | "agent"

interface Workspace {
  doc: LoroDoc
  starred: LoroMap
  tagEmoji: LoroMap
  persisted: Persisted
}

interface SyncMessage {
  /** "close": a diagram was purged, or with no id every diagram was deleted. */
  type: "update" | "index" | "settings" | "close"
  id?: DiagramId
  /** For "index": the diagrams whose rows changed. */
  ids?: DiagramId[]
  bytes?: Uint8Array
}

export class Eos {
  private listeners = new Map<Topic, Set<Listener>>()
  private open = new Map<DiagramId, Promise<OpenDiagram>>()
  private channel: BroadcastChannel | null = null
  /** Listeners for when an open diagram is closed (see SourceBinding.onClose). */
  private closed = new Map<DiagramId, Set<() => void>>()
  /** Pending library-index refreshes for diagrams being typed in (see bindSource). */
  private indexTimers = new Map<DiagramId, { timer: ReturnType<typeof setTimeout>; run: () => void }>()
  private settingsCache: AppSettings = DEFAULT_SETTINGS
  /**
   * Every index row, read once and shared by lists, counts and searches until the library
   * next changes (see emit). A re-read keeps the old object for each row that hasn't changed.
   */
  private rows: Promise<DiagramIndexRow[]> | null = null
  private rowsById = new Map<DiagramId, DiagramIndexRow>()
  /** The search index over those rows (the read it was built from), built on the first search after a change. */
  private searcher: { rows: Promise<DiagramIndexRow[]>; built: Promise<Search | null> } | null = null
  /** Changes being made to copies of diagrams that aren't open, by diagram: the last one queued (see mutate). */
  private turns = new Map<DiagramId, Promise<void>>()
  /** Bulk changes running (see batch), and the events and index refreshes they're holding back. */
  private batching = { depth: 0, topics: new Set<Topic>(), ids: new Set<DiagramId>() }

  private db: Database
  private workspace: Workspace

  private constructor(db: Database, workspace: Workspace) {
    this.db = db
    this.workspace = workspace
  }

  static async create(options: { dbName?: string; seed?: boolean } & OpenHooks = {}): Promise<Eos> {
    const db = await openEosDB(options.dbName, options)
    const doc = await loadDoc(db, WORKSPACE_ID)
    // Only a commit runs this callback, and only eos's methods commit the workspace, so eos is set by then.
    const persisted = persistDoc(db, WORKSPACE_ID, doc, (bytes) => eos.broadcast({ type: "update", id: WORKSPACE_ID, bytes }))
    const eos = new Eos(db, { doc, starred: doc.getMap("starred"), tagEmoji: doc.getMap("tagEmoji"), persisted })
    eos.settingsCache = withDefaults(await db.get("settings", "app"))
    eos.listenToOtherTabs()
    // Save what's pending if the tab is closed, or hidden: a mobile browser may discard a
    // hidden tab without a pagehide.
    if (typeof addEventListener === "function") addEventListener("pagehide", () => eos.saveNow())
    // Shown again, check the cached rows: a tab closed partway through a bulk change never sent
    // the index message for it.
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? eos.saveNow() : void eos.recheckRows()))
    await eos.backfillSearchText()
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
    // Index rows only change along with a "library" event, so this is where the cached read goes stale.
    if (topics.includes("library")) this.rows = this.searcher = null
    if (this.batching.depth) for (const t of topics) this.batching.topics.add(t)
    else for (const t of topics) this.listeners.get(t)?.forEach((l) => l())
  }

  /**
   * Runs `fn`, a change to many diagrams, sending each event once, and other tabs one index
   * refresh, at the end instead of once per diagram. Events from anything else that runs
   * meanwhile wait for the end too.
   */
  private async batch<T>(fn: () => Promise<T>): Promise<T> {
    const b = this.batching
    b.depth++
    try {
      return await fn()
    } finally {
      if (--b.depth === 0) {
        const topics = [...b.topics]
        const ids = [...b.ids]
        b.topics.clear()
        b.ids.clear()
        // This tab's events first: posting can throw (the channel is closed as the page unloads).
        this.emit(...topics)
        if (ids.length) this.broadcast({ type: "index", ids })
      }
    }
  }

  /** A diagram's index row changed: tells this tab's views, and other tabs (once per batch). */
  private indexChanged(id: DiagramId) {
    this.emit("library", `diagram:${id}`)
    if (this.batching.depth) this.batching.ids.add(id)
    else this.broadcast({ type: "index", ids: [id] })
  }

  // ── Library ────────────────────────────────────────────────────────────────

  async listDiagrams(filter: LibraryFilter = {}): Promise<DiagramIndexRow[]> {
    const read = this.allRows()
    let rows = await read
    rows = rows.filter((r) => (filter.deleted ? !!r.deletedAt : filter.includeDeleted || !r.deletedAt))
    if (filter.starred) rows = rows.filter((r) => r.starred === 1)
    for (const tag of normalizeTags(filter.tags ?? [])) rows = rows.filter((r) => r.tags.some((t) => tagMatches(t, tag)))
    const q = filter.query?.trim()
    // A search ranks by relevance (title first, then contents) instead of the sort order.
    if (q) {
      const search = await this.search(read)
      // The library changed while the index was being built: search what's there now.
      return search ? search(rows, q) : this.listDiagrams(filter)
    }
    const sort = filter.sort ?? "modified"
    rows.sort((a, b) =>
      sort === "title" ? a.titleKey.localeCompare(b.titleKey) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt
    )
    return rows
  }

  /**
   * Builds the search index ahead of a search (when the search box is focused, say) while
   * the page is idle, so the first keystroke doesn't wait for it.
   */
  prepareSearch() {
    const idle = globalThis.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1))
    idle(() => void this.search().catch(() => {}))
  }

  async listTags(): Promise<TagRecord[]> {
    const rows = await this.allRows()
    return buildTagTree(rows, this.workspace.tagEmoji.toJSON() as Record<string, string | null>)
  }

  async counts(): Promise<{ all: number; starred: number; deleted: number }> {
    const all = await this.allRows()
    const rows = all.filter((r) => !r.deletedAt)
    return { all: rows.length, starred: rows.filter((r) => r.starred).length, deleted: all.length - rows.length }
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
      version: encodeVersion(d.doc),
      starred: row.starred === 1,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }
  }

  async createDiagram(input: { title?: string; source?: string; tags?: string[] } = {}, actor: Actor = USER): Promise<DiagramId> {
    const id = crypto.randomUUID()
    const doc = new LoroDoc()
    doc.setRecordTimestamp(true)
    const meta = doc.getMap("meta")
    meta.set("title", input.title?.trim() || "Untitled")
    meta.set("createdAt", Date.now())
    setTags(meta, normalizeTags(input.tags ?? []))
    doc.getText("source").insert(0, input.source ?? "flowchart TD\n  A[Start] --> B[End]\n")
    commit(doc, actor)
    await compact(this.db, id, doc, () => this.indexRow(id, doc))
    this.indexChanged(id)
    return id
  }

  /**
   * Changes title, source and tags. Title and tags are details, on nobody's undo stack;
   * the source change is undoable. With `base`, the version the source was read at, the
   * source is applied as the edits that turn that version into it, so anything changed
   * since (e.g. the person typing while an agent worked) is kept instead of overwritten.
   */
  async editDiagram(
    id: DiagramId,
    edit: { title?: string; source?: string; addTags?: string[]; removeTags?: string[] },
    actor: Actor = USER,
    { base }: { base?: string } = {}
  ) {
    await this.mutate(id, actor, (d) => {
      // Work out the source edits first: reading the old version forks the doc, which
      // would otherwise save this edit's other changes early, without their label.
      const fromBase = edit.source !== undefined && base && base !== encodeVersion(d.doc) ? editsFromBase(d, base, edit.source) : null
      if (edit.title !== undefined) d.meta.set("title", edit.title.trim() || "Untitled")
      if (edit.addTags?.length || edit.removeTags?.length) {
        const drop = new Set(normalizeTags(edit.removeTags ?? []))
        setTags(
          d.meta,
          normalizeTags([...metaOf(d).tags, ...(edit.addTags ?? [])]).filter((t) => !drop.has(t))
        )
      }
      // Title and tags are details (see mutate); the source change below stays undoable.
      commit(d.doc, actor, { details: true })
      if (fromBase) applyEdits(d.text, fromBase)
      else if (edit.source !== undefined) d.text.update(edit.source)
    })
  }

  async renameDiagram(id: DiagramId, title: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => d.meta.set("title", title.trim() || "Untitled"), { details: true })
  }

  async duplicateDiagram(id: DiagramId, title?: string, actor: Actor = USER): Promise<DiagramId> {
    const d = await this.openDiagram(id)
    const meta = metaOf(d)
    return this.createDiagram({ title: title ?? `${meta.title} copy`, source: sourceOf(d), tags: meta.tags }, actor)
  }

  /** Moves diagrams to Deleted (see Ids). */
  async deleteDiagram(ids: Ids) {
    await this.each(ids, (id) => this.patchIndex(id, { deletedAt: Date.now() }))
  }

  async restoreDiagram(ids: Ids) {
    await this.each(ids, (id) => this.patchIndex(id, { deletedAt: undefined }))
  }

  // ── Source ─────────────────────────────────────────────────────────────────

  async getSource(id: DiagramId, version?: string): Promise<string> {
    const d = await this.openDiagram(id)
    if (!version) return sourceOf(d)
    return d.doc.forkAt(frontiersOf(d, version)).getText("source").toString()
  }

  /** Binds an editor to a diagram's source (see SourceBinding). */
  async bindSource(id: DiagramId): Promise<SourceBinding> {
    const opened = this.openDiagram(id)
    const d = await opened
    return {
      text: () => d.text.toString(),
      edit: (changes) => {
        // Closing a diagram (a delete, or a backup replacing it) drops it from this.open.
        if (this.open.get(id) !== opened) return
        applyEdits(d.text, changes)
        // Its own origin, so onChange can skip it; it's still the person's edit for undo and history.
        d.doc.commit({ origin: EDITOR_ORIGIN, message: JSON.stringify(USER) })
        // The edit is saved and sent to other tabs by now; the library index (title, search
        // text, date) catches up once typing pauses rather than on every keystroke.
        this.refreshIndexSoon(id, d)
      },
      onClose: (listener) => this.onClosed(id, listener),
      // Loro reports changes synchronously, as they're committed or imported.
      onChange: (listener) =>
        d.text.subscribe((batch) => {
          if (batch.by === "local" && batch.origin === EDITOR_ORIGIN) return
          for (const event of batch.events) {
            if (event.diff.type !== "text") continue
            const changes: TextChange[] = []
            let pos = 0
            for (const op of event.diff.diff) {
              if (op.retain !== undefined) pos += op.retain
              else if (op.delete !== undefined) {
                changes.push({ from: pos, to: pos + op.delete, insert: "" })
                pos += op.delete
              } else if (op.insert !== undefined) changes.push({ from: pos, to: pos, insert: op.insert })
            }
            if (changes.length) listener(changes)
          }
        }),
    }
  }

  async setSource(id: DiagramId, source: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => d.text.update(source))
  }

  // ── History ────────────────────────────────────────────────────────────────

  /** Undoes the person's last edit, or with scope "agent" the agent's last edit. Each skips the other's edits. */
  async undo(id: DiagramId, scope: UndoScope = "user", actor?: Actor): Promise<boolean> {
    return this.step(id, scope, "undo", actor)
  }

  async redo(id: DiagramId, scope: UndoScope = "user", actor?: Actor): Promise<boolean> {
    return this.step(id, scope, "redo", actor)
  }

  private async step(id: DiagramId, scope: UndoScope, dir: "undo" | "redo", actor?: Actor): Promise<boolean> {
    const d = await this.openDiagram(id)
    const by: Actor = actor ?? (scope === "agent" ? { kind: "agent", tool: dir, changes: [dir] } : USER)
    const stack = scope === "agent" ? d.agentUndo : d.undo
    const top = () => (dir === "undo" ? stack.topUndoValue() : stack.topRedoValue())
    const burst = top()
    let done = false
    d.burst.stepping = burst
    try {
      do {
        // Label each commit the undo manager makes, so the other stack ignores it and history credits the right actor.
        d.doc.setNextCommitOptions({ origin: actorOrigin(by), message: JSON.stringify(by) })
        if (!stack[dir]()) break
        done = true
      } while (scope === "user" && burst !== undefined && top() === burst)
    } finally {
      d.burst.stepping = undefined
    }
    if (done) await this.afterChange(id, d)
    return done
  }

  async canUndo(id: DiagramId, scope: UndoScope = "user"): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const d = await this.openDiagram(id)
    const stack = scope === "agent" ? d.agentUndo : d.undo
    return { canUndo: stack.canUndo(), canRedo: stack.canRedo() }
  }

  async history(id: DiagramId, limit?: number): Promise<HistoryEntry[]> {
    return historyOf((await this.openDiagram(id)).doc, limit)
  }

  async restoreVersion(id: DiagramId, version: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => d.doc.revertTo(frontiersOf(d, version)))
  }

  // ── Organisation ───────────────────────────────────────────────────────────

  async setStarred(ids: Ids, starred: boolean, actor: Actor = USER) {
    try {
      await this.each(ids, async (id) => {
        await this.patchIndex(id, { starred: starred ? 1 : 0 })
        // Only once the diagram is known to be there, so a missing one isn't left a star.
        if (starred) this.workspace.starred.set(id, true)
        else this.workspace.starred.delete(id)
      })
    } finally {
      commit(this.workspace.doc, actor)
    }
  }

  async addTags(ids: Ids, tags: string[], actor: Actor = USER) {
    await this.each(ids, (id) =>
      this.mutate(id, actor, (d) => setTags(d.meta, normalizeTags([...metaOf(d).tags, ...tags])), { details: true })
    )
  }

  async removeTags(ids: Ids, tags: string[], actor: Actor = USER) {
    const drop = new Set(normalizeTags(tags))
    await this.each(ids, (id) =>
      this.mutate(
        id,
        actor,
        (d) =>
          setTags(
            d.meta,
            metaOf(d).tags.filter((t) => !drop.has(t))
          ),
        { details: true }
      )
    )
  }

  async renameTag(from: string, to: string, actor: Actor = USER) {
    const src = normalizeTag(from)
    const dst = normalizeTag(to)
    if (!src || !dst || src === dst) return
    await this.batch(async () => {
      const rows = await this.db.getAllFromIndex("diagrams", "byTag", src)
      await this.each(
        rows.map((row) => row.id),
        (id) =>
          this.mutate(
            id,
            actor,
            (d) => setTags(d.meta, normalizeTags(metaOf(d).tags.map((t) => (tagMatches(t, src) ? dst + t.slice(src.length) : t)))),
            { details: true }
          )
      )
      // The tags' emoji move with them; a tag merged into one that has its own emoji keeps that one.
      const emoji = this.workspace.tagEmoji
      const moved = emoji.keys().filter((key) => tagMatches(key, src))
      const values = moved.map((key) => [dst + key.slice(src.length), emoji.get(key)] as const)
      for (const key of moved) emoji.delete(key)
      for (const [key, value] of values) if (emoji.get(key) === undefined) emoji.set(key, value)
      commit(this.workspace.doc, actor)
      this.emit("library")
    })
  }

  /** Removes a tag (and any tags nested under it) from every diagram. */
  async deleteTag(path: string, actor: Actor = USER): Promise<number> {
    const tag = normalizeTag(path)
    if (!tag) return 0
    return this.batch(async () => {
      const rows = await this.db.getAllFromIndex("diagrams", "byTag", tag)
      await this.each(
        rows.map((row) => row.id),
        (id) =>
          this.mutate(
            id,
            actor,
            (d) =>
              setTags(
                d.meta,
                metaOf(d).tags.filter((t) => !tagMatches(t, tag))
              ),
            { details: true }
          )
      )
      for (const key of this.workspace.tagEmoji.keys()) if (tagMatches(key, tag)) this.workspace.tagEmoji.delete(key)
      commit(this.workspace.doc, actor)
      this.emit("library")
      return rows.length
    })
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
      // A diagram that isn't open is loaded just for this and freed, rather than kept open.
      const open = await this.ifOpen(row.id)
      const doc = open?.doc ?? (await loadDoc(this.db, row.id))
      diagrams.push({ id: row.id, deletedAt: row.deletedAt, snapshot: toBase64(doc.export({ mode: "snapshot" })) })
      if (!open) doc.free()
    }
    return JSON.stringify({
      v: 1,
      settings: { theme: this.settingsCache.theme },
      workspace: toBase64(this.workspace.doc.export({ mode: "snapshot" })),
      diagrams,
    })
  }

  /**
   * `data` is a backup file's text, or what readBackup returned for it (so a caller that
   * checked it first doesn't decode it twice). Throws, before touching the library, if it
   * isn't a readable Eos backup.
   */
  async importBackup(data: string | Backup, mode: "merge" | "replace") {
    const { settings, workspace, diagrams } = typeof data === "string" ? readBackup(data) : data
    await this.batch(async () => {
      if (mode === "replace") await this.deleteAll({ reseed: false })
      // Imported ops aren't local updates, so persistDoc neither saves nor broadcasts them:
      // each import below saves its doc whole and sends the ops to other tabs itself.
      if (workspace) {
        this.workspace.doc.import(workspace)
        await compact(this.db, WORKSPACE_ID, this.workspace.doc)
        this.broadcast({ type: "update", id: WORKSPACE_ID, bytes: workspace })
        if (mode === "replace") {
          // The wipe's deletes are newer than the backup's stars and emoji (always, for this
          // library's own backup), so they'd win: set them again, as changes made now.
          const backup = new LoroDoc()
          backup.import(workspace)
          for (const name of ["starred", "tagEmoji"] as const)
            for (const [key, value] of Object.entries(backup.getMap(name).toJSON() as Record<string, Value>))
              this.workspace[name].set(key, value)
          backup.free()
          commit(this.workspace.doc, { kind: "import", source: "backup" })
        }
      }
      for (const { bytes, ...item } of diagrams) {
        // Something may be opening the diagram right now (e.g. an editor rebinding after the
        // wipe above); an open that failed because it wasn't there yet just means "not open".
        const d = await this.ifOpen(item.id)
        if (d) {
          d.doc.import(bytes)
          // The snapshot exists already, so saving it apart from the index row (in afterChange,
          // like any edit) can't leave a diagram the library doesn't list.
          await compact(this.db, item.id, d.doc)
          await this.afterChange(item.id, d)
        } else {
          const existing = await loadDoc(this.db, item.id)
          existing.import(bytes)
          // A diagram already here keeps whether it's deleted, as an open one does (see rowOf).
          await compact(this.db, item.id, existing, (doc, saved) =>
            this.indexRow(item.id, doc, saved ? saved.deletedAt : (item.deletedAt ?? undefined))
          )
          existing.free()
          this.indexChanged(item.id)
        }
        this.broadcast({ type: "update", id: item.id, bytes })
      }
      if (settings?.theme) await this.updateSettings({ theme: { ...this.settingsCache.theme, ...settings.theme } })
    })
  }

  async deleteAll({ reseed = false } = {}) {
    const tx = this.db.transaction(["snapshots", "updates", "diagrams"], "readwrite")
    const cleared = Promise.all([
      tx.objectStore("snapshots").clear(),
      tx.objectStore("updates").clear(),
      tx.objectStore("diagrams").clear(),
      tx.done,
    ])
    // Closed after the wipe is queued (see close).
    await Promise.all([...this.open.keys()].map((id) => this.close(id)))
    await cleared
    for (const key of this.workspace.starred.keys()) this.workspace.starred.delete(key)
    for (const key of this.workspace.tagEmoji.keys()) this.workspace.tagEmoji.delete(key)
    commit(this.workspace.doc, { kind: "system", reason: "delete-all" })
    // The wipe took the workspace's saved history too, which that change builds on: save it whole.
    await compact(this.db, WORKSPACE_ID, this.workspace.doc)
    this.broadcast({ type: "close" })
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
    const candidates = (await this.allRows()).filter(
      (r) => !r.deletedAt && r.title === (title.trim() || "Untitled") && r.sourceText === source
    )
    // The index can trail an edit by a moment, so check the diagram itself before reusing it.
    for (const row of candidates) if ((await this.getSource(row.id)) === source) return row.id
    return null
  }

  /** Permanently removes soft-deleted diagrams. */
  async purge(ids: Ids) {
    try {
      await this.each(ids, async (id) => {
        const deleted = deleteDocData(this.db, id)
        // Closed after the delete is queued (see close).
        await this.close(id)
        await deleted
        this.workspace.starred.delete(id)
        this.emit("library")
        this.broadcast({ type: "close", id })
      })
    } finally {
      commit(this.workspace.doc, USER)
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  openDiagram(id: DiagramId): Promise<OpenDiagram> {
    let p = this.open.get(id)
    if (!p) {
      p = (async () => {
        // A change being made to a copy (see mutate) is read in once it's saved.
        await this.turns.get(id)
        const doc = await loadDoc(this.db, id)
        if (doc.oplogVersion().length() === 0 && !(await this.db.get("diagrams", id))) {
          throw new Error(`Diagram ${id} not found`)
        }
        // Commit origins are "user" or "user:editor" (keystrokes), "agent:<tool>", "import" or
        // "system", each prefixed "details:" for title and tag changes (see actorOrigin, commit).
        // Each step is tagged with the burst of typing it belongs to (a new burst after a pause).
        // Edits from other tabs split Loro's steps mid-burst, so ⌘Z undoes every step of a burst.
        const burst: OpenDiagram["burst"] = { count: 0, lastEdit: 0, stepping: undefined }
        const undo = new UndoManager(doc, {
          mergeInterval: MERGE_MS,
          maxUndoSteps: 200,
          excludeOriginPrefixes: ["agent", "import", "system", DETAILS],
          onPush: () => {
            // A step moving between the undo and redo stacks keeps its burst.
            if (burst.stepping !== undefined) return { value: burst.stepping, cursors: [] }
            const now = Date.now()
            if (now - burst.lastEdit > MERGE_MS) burst.count++
            burst.lastEdit = now
            return { value: burst.count, cursors: [] }
          },
        })
        const agentUndo = new UndoManager(doc, {
          mergeInterval: 0,
          maxUndoSteps: 200,
          excludeOriginPrefixes: ["user", "import", "system", DETAILS],
        })
        const persisted = persistDoc(this.db, id, doc, (bytes) => this.broadcast({ type: "update", id, bytes }))
        return {
          id,
          doc,
          text: doc.getText("source"),
          meta: doc.getMap("meta"),
          undo,
          agentUndo,
          burst,
          persisted,
          // Only deletes close a diagram, so a pending index refresh and any queued writes are
          // dropped, not run (either could write the diagram back after the delete).
          dispose: () => {
            clearTimeout(this.indexTimers.get(id)?.timer)
            this.indexTimers.delete(id)
            persisted.stop()
            this.closed.get(id)?.forEach((listener) => listener())
            this.closed.delete(id)
          },
        }
      })()
      this.open.set(id, p)
      p.catch(() => this.open.delete(id))
    }
    return p
  }

  /**
   * Makes a change as `actor`. With `details`, it's a title or tag change: saved and in
   * history like any other, but on nobody's undo stack. Those are single values, so
   * undoing one would overwrite whatever anyone set since; text undo merges instead.
   *
   * Opening a diagram sets up its undo stacks (and keeps it in memory), which a details
   * change doesn't need, so one to a diagram that isn't open is made on a copy loaded for
   * it and freed after: a change to many diagrams (renaming a tag) doesn't leave them all
   * open. Such changes to one diagram run one at a time, each on what the last one saved,
   * since setting tags replaces the whole list. Either way the change is committed, saved,
   * and its index row rebuilt from the row saved now, and a diagram purged meanwhile is
   * left gone: that throws "not found".
   */
  private async mutate(id: DiagramId, actor: Actor, fn: (d: Editable) => void, { details = false } = {}) {
    if (!details || this.open.has(id)) {
      const d = await this.openDiagram(id)
      change(d, actor, fn, { details, undo: actor.kind === "agent" ? d.agentUndo : d.undo })
      // persistDoc saves the change as it's committed.
      if (!(await this.afterChange(id, d))) throw new Error(`Diagram ${id} not found`)
      return
    }
    await this.inTurn(id, async () => {
      const doc = await loadDoc(this.db, id)
      try {
        const before = doc.oplogVersion()
        change({ id, doc, text: doc.getText("source"), meta: doc.getMap("meta") }, actor, fn, { details })
        if (!(await compact(this.db, id, doc, this.rowOf(id)))) throw new Error(`Diagram ${id} not found`)
        this.broadcast({ type: "update", id, bytes: doc.export({ mode: "update", from: before }) })
      } finally {
        doc.free()
      }
    })
    this.indexChanged(id)
  }

  /** Runs `task` once the changes queued before it for this diagram (see mutate) are done. */
  private inTurn(id: DiagramId, task: () => Promise<void>): Promise<void> {
    const run = (this.turns.get(id) ?? Promise.resolve()).then(task)
    const queued = run.catch(() => {})
    this.turns.set(id, queued)
    void queued.then(() => this.turns.get(id) === queued && this.turns.delete(id))
    return run
  }

  /** The diagram if it's open, or opening; an open that failed means it isn't. */
  private async ifOpen(id: DiagramId): Promise<OpenDiagram | undefined> {
    return this.open.get(id)?.catch(() => undefined)
  }

  /**
   * Runs `fn` for one diagram, or for each of several in turn as one batch (see batch). In a
   * batch, a missing one is skipped, so it doesn't stop the rest.
   */
  private async each(ids: Ids, fn: (id: DiagramId) => Promise<unknown>) {
    if (!Array.isArray(ids)) return void (await fn(ids))
    await this.batch(async () => {
      for (const id of ids) {
        try {
          await fn(id)
        } catch (error) {
          if (await this.db.get("diagrams", id)) throw error
        }
      }
    })
  }

  /**
   * Closes an open diagram whose data is being deleted. Call it once the delete's transaction
   * exists: an editor told of the close binds again straight away, and its read must queue
   * behind the delete, or it would reopen the old data. An open that failed left nothing to close.
   */
  private async close(id: DiagramId) {
    const opened = this.open.get(id)
    this.open.delete(id)
    ;(await opened?.catch(() => undefined))?.dispose()
  }

  private onClosed(id: DiagramId, listener: () => void): () => void {
    const set = this.closed.get(id) ?? new Set()
    set.add(listener)
    this.closed.set(id, set)
    return () => set.delete(listener)
  }

  private refreshIndexSoon(id: DiagramId, d: DiagramDoc) {
    clearTimeout(this.indexTimers.get(id)?.timer)
    const run = () => {
      this.indexTimers.delete(id)
      void this.afterChange(id, d)
    }
    this.indexTimers.set(id, { timer: setTimeout(run, INDEX_MS), run })
  }

  /**
   * When the page goes away: retries a failed write instead of waiting for the next edit,
   * then refreshes pending index rows. The docs go first, as the index can be rebuilt from them.
   */
  private saveNow() {
    this.workspace.persisted.retry()
    const opened = [...this.open.values()].map((p) =>
      p.then(
        (d) => d.persisted.retry(),
        () => {}
      )
    )
    void Promise.all(opened).then(() => this.flushIndex())
  }

  /** Runs a pending index refresh now (before closing a diagram, or when the page goes away). */
  flushIndex(id?: DiagramId) {
    for (const [key, pending] of [...this.indexTimers]) {
      if (id !== undefined && key !== id) continue
      clearTimeout(pending.timer)
      pending.run()
    }
  }

  /** Rebuilds an open diagram's index row. Returns false, writing nothing, if the diagram has been purged. */
  private async afterChange(id: DiagramId, d: DiagramDoc): Promise<boolean> {
    if (!(await updateRow(this.db, id, (saved) => this.rowOf(id)(d.doc, saved)))) return false
    this.indexChanged(id)
    return true
  }

  /** Builds an existing diagram's index row, keeping whether it's deleted; nothing if it's gone. */
  private rowOf(id: DiagramId): RowBuilder {
    return (doc, saved) => saved && this.indexRow(id, doc, saved.deletedAt)
  }

  private indexRow(id: DiagramId, doc: LoroDoc, deletedAt?: number): DiagramIndexRow {
    const d = { text: doc.getText("source"), meta: doc.getMap("meta") }
    const meta = metaOf(d)
    const source = sourceOf(d)
    return {
      id,
      title: meta.title,
      tags: meta.tags,
      tagPrefixes: tagPrefixes(meta.tags),
      createdAt: meta.createdAt,
      updatedAt: lastChangeAt(doc) || Date.now(),
      titleKey: meta.title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase(),
      starred: this.workspace.starred.get(id) ? 1 : 0,
      sourcePreview: source.slice(0, 200),
      sourceText: source,
      ...(deletedAt ? { deletedAt } : {}),
    }
  }

  /** Rows written before search covered full contents only have a preview; fill them in once. */
  private async backfillSearchText() {
    const rows = await this.db.getAll("diagrams")
    for (const row of rows) {
      if (row.sourceText !== undefined) continue
      const doc = await loadDoc(this.db, row.id)
      await this.db.put("diagrams", { ...row, sourceText: doc.getText("source").toString() })
    }
  }

  private async patchIndex(id: DiagramId, patch: Partial<DiagramIndexRow>) {
    const patched = await updateRow(this.db, id, (row) => {
      if (!row) return undefined
      const next = { ...row, ...patch }
      if (patch.deletedAt === undefined && "deletedAt" in patch) delete next.deletedAt
      return next
    })
    if (!patched) throw new Error(`Diagram ${id} not found`)
    this.indexChanged(id)
  }

  /** Every index row, from the cache when the library hasn't changed since the last read. */
  private allRows(): Promise<DiagramIndexRow[]> {
    const read = (this.rows ??= this.db.getAll("diagrams").then((rows) => {
      // Unchanged rows keep their old object, so views that memoise on a row can skip it.
      const kept = rows.map((row) => {
        const old = this.rowsById.get(row.id)
        return old && sameRow(old, row) ? old : row
      })
      this.rowsById = new Map(kept.map((row) => [row.id, row]))
      return kept
    }))
    // A failed read isn't kept: the next one tries again.
    read.catch(() => this.rows === read && (this.rows = null))
    return read
  }

  /** Reads the rows again, and refreshes the library if any differ from the ones last read. */
  private async recheckRows() {
    const cached = this.rowsById
    const rows = await this.db.getAll("diagrams")
    const differs = (row: DiagramIndexRow) => {
      const old = cached.get(row.id)
      return !old || !sameRow(old, row)
    }
    if (rows.length !== cached.size || rows.some(differs)) this.emit("library")
  }

  /**
   * The search index over the rows `read` returns (by default the current read), built once
   * per change to the library. It's null if the library changed before it was done: the
   * build stops early, since nothing would use it.
   */
  private search(read = this.allRows()): Promise<Search | null> {
    if (this.searcher?.rows === read) return this.searcher.built
    const built: Promise<Search | null> = read.then((rows) => searchIndex(rows, () => this.rows !== read))
    if (this.rows === read) {
      this.searcher = { rows: read, built }
      // A failed build isn't kept: the next search tries again.
      built.catch(() => this.searcher?.built === built && (this.searcher = null))
    }
    return built
  }

  private broadcast(msg: SyncMessage) {
    this.channel?.postMessage(msg)
  }

  private listenToOtherTabs() {
    if (typeof BroadcastChannel === "undefined") return
    this.channel = new BroadcastChannel("eos")
    this.channel.onmessage = async ({ data }: MessageEvent<SyncMessage>) => {
      if (data.type === "settings") {
        this.settingsCache = withDefaults(await this.db.get("settings", "app"))
        this.emit("settings")
      } else if (data.type === "update" && data.id && data.bytes) {
        if (data.id === WORKSPACE_ID) this.workspace.doc.import(data.bytes)
        else if (this.open.has(data.id)) (await this.openDiagram(data.id)).doc.import(data.bytes)
        // A diagram's index row changes only with the "index" message that follows (once typing
        // pauses); the workspace holds stars and tag emoji, which the library shows.
        this.emit(data.id === WORKSPACE_ID ? "library" : `diagram:${data.id}`)
      } else if (data.type === "index") {
        this.emit("library", ...(data.ids ?? []).map((id) => `diagram:${id}` as const))
      } else if (data.type === "close") {
        // Its data is gone from disk already; an open copy here would keep saving edits to it.
        const ids = data.id ? [data.id] : [...this.open.keys()]
        await Promise.all(ids.map((id) => this.close(id)))
        this.emit("library", ...ids.map((id) => `diagram:${id}` as const))
      }
    }
  }
}

/** Fills in settings added after a record was first saved. */
function withDefaults(saved: Partial<AppSettings> | undefined): AppSettings {
  return {
    theme: { ...DEFAULT_SETTINGS.theme, ...saved?.theme },
    agent: { ...DEFAULT_SETTINGS.agent, ...saved?.agent },
  }
}

export type Backup = ReturnType<typeof readBackup>

/**
 * Parses and decodes a backup file, throwing a readable error if it isn't one.
 * Every snapshot is decoded up front, so a damaged file fails before an import
 * that replaces the library deletes anything.
 */
export function readBackup(data: string) {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    throw new Error("This file isn't an Eos backup (it isn't JSON)")
  }
  const parsed = BackupSchema.safeParse(json)
  if (!parsed.success) throw new Error(`This file isn't an Eos backup: ${z.prettifyError(parsed.error)}`)
  const { settings, workspace, diagrams } = parsed.data
  /** The bytes, loaded into a throwaway doc first so bytes Loro can't read throw here. */
  const decode = (base64: string) => {
    const bytes = fromBase64(base64)
    new LoroDoc().import(bytes)
    return bytes
  }
  try {
    return {
      settings,
      workspace: workspace ? decode(workspace) : null,
      diagrams: diagrams.map(({ snapshot, ...item }) => ({ ...item, bytes: decode(snapshot) })),
    }
  } catch {
    throw new Error("This backup is damaged: a diagram's data can't be read")
  }
}

/**
 * The backup file format (v1), as exportBackup writes it. Settings are partial; missing ones keep their current values.
 * Only the theme travels: agent settings are the person's say over what agents may do, and agents can import backups,
 * so a backup never changes them (older backups that carry them have them dropped here).
 */
const BackupSchema = z.object({
  v: z.literal(1),
  settings: z.optional(
    z.object({
      theme: z.optional(
        z.object({
          mode: z.optional(z.enum(["system", "light", "dark"])),
          customCss: z.optional(z.nullable(z.string())),
          diagramCss: z.optional(z.nullable(z.string())),
        })
      ),
    })
  ),
  workspace: z.optional(z.string()),
  diagrams: z.array(z.object({ id: z.string(), deletedAt: z.optional(z.nullable(z.number())), snapshot: z.string() })),
})

/** Thrown when a version passed in is not one of the diagram's; nothing has changed. */
export class UnknownVersionError extends Error {}

/** The frontiers `version` names, or `UnknownVersionError` if the diagram has no such version. */
function frontiersOf(d: Editable, version: string): Frontiers {
  const frontiers = decodeVersion(version)
  const wellFormed = (f: Frontiers[number]) => /^\d+$/.test(f.peer) && Number.isSafeInteger(f.counter) && f.counter >= 0
  try {
    // Loro panics on an id it can't parse (a negative counter, say), and the doc is unusable after.
    if (!frontiers.length || !frontiers.every(wellFormed)) throw new Error("Malformed version")
    d.doc.frontiersToVV(frontiers)
  } catch {
    throw new UnknownVersionError(`Diagram ${d.id} has no version ${version}`)
  }
  return frontiers
}

/**
 * The edits that turn the text at version `base` into `source`, each placed where that
 * spot of text is now. Loro cursors map positions from the old text to the current one,
 * so changes made since `base` elsewhere in the text are kept.
 */
function editsFromBase(d: Editable, base: string, source: string): TextChange[] {
  const old = d.doc.forkAt(frontiersOf(d, base)).getText("source")
  // Where the gap before the old text's i-th character is now. It's anchored on that character,
  // which, if deleted since, still maps to where it was, so text deleted on both sides isn't counted twice.
  const gapBefore = (i: number) => (i >= old.length ? d.text.length : (d.doc.getCursorPos(old.getCursor(i)!)?.offset ?? i))
  const edits: TextChange[] = []
  let pos = 0
  for (const part of diffChars(old.toString(), source)) {
    if (part.added) edits.push({ from: gapBefore(pos), to: gapBefore(pos), insert: part.value })
    else {
      if (part.removed) edits.push({ from: gapBefore(pos), to: gapBefore(pos + part.value.length), insert: "" })
      pos += part.value.length
    }
  }
  return edits
}

/** Runs `fn` and commits what it did as `actor`: one step on `undo`, if given (see Eos.mutate). */
function change(
  d: Editable,
  actor: Actor,
  fn: (d: Editable) => void,
  { details = false, undo }: { details?: boolean; undo?: UndoManager }
) {
  undo?.groupStart()
  try {
    fn(d)
    commit(d.doc, actor, { details })
  } finally {
    undo?.groupEnd()
  }
}

/** Whether two reads of an index row hold the same values. Rows are flat apart from their tag lists. */
function sameRow(a: DiagramIndexRow, b: DiagramIndexRow): boolean {
  const keys = Object.keys(b) as (keyof DiagramIndexRow)[]
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((k) => {
    const x = a[k]
    const y = b[k]
    return Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((v, i) => v === y[i]) : x === y
  })
}

/** Applies edits given in ascending order, in the coordinates of the text before any of them. */
function applyEdits(text: LoroText, edits: TextChange[]) {
  // Last first, so earlier positions stay valid.
  for (const e of [...edits].reverse()) {
    if (e.to > e.from) text.delete(e.from, e.to - e.from)
    if (e.insert) text.insert(e.from, e.insert)
  }
}
