import { type Cursor, type Delta, type Frontiers, LoroDoc, type LoroMap, type LoroText, UndoManager, type Value } from "loro-crdt"
import * as z from "zod/mini"

import { fromBase64, toBase64 } from "./base64"
import { openEosDB, WORKSPACE_ID, type Database, type OpenHooks, type StoredRow } from "./db"
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
  newDiagramDoc,
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
/** Keystrokes closer together than this are one undo step. */
const MERGE_MS = 800
/** How long the library index waits for typing to pause. */
const INDEX_MS = 300

/**
 * A source with \n line breaks only, as every source coming in is stored. A `\r` already stored (by
 * an older version, or in a backup) is kept as it is: the editor counts it as a character like any
 * other, so the editor and the doc still agree on every position.
 */
const lf = (source: string) => source.replace(/\r\n?/g, "\n")

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
  /** The person's selection (see SourceBinding.select), and who's told where an undo or redo puts it back. */
  selection: { cursors: Cursor[]; listeners: Set<(anchor: number, head: number) => void> }
  persisted: Persisted
}

/** What a change made through mutate works on: an open diagram, or a copy loaded for the change. */
type Editable = Pick<DiagramDoc, "id" | "doc" | "text" | "meta">

/**
 * One diagram, or several. A change to several is one batch (one library event, one index
 * message to other tabs) and skips any that are missing; a single missing one throws, except in
 * purge, which has nothing left to remove.
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
    // Try to save what's pending if the tab is closed, or hidden: a mobile browser may discard a
    // hidden tab without a pagehide. Writes started then may never land; rows are repaired below.
    if (typeof addEventListener === "function") addEventListener("pagehide", () => eos.saveNow())
    // Shown again, check the cached rows: a tab closed partway through a bulk change never sent
    // the index message for it.
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? eos.saveNow() : void eos.recheckRows()))
    await eos.backfillSearchText()
    await eos.repairRows()
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
    const sort = filter.sort ?? "modified"
    rows.sort((a, b) =>
      sort === "title" ? a.titleKey.localeCompare(b.titleKey) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt
    )
    const q = filter.query?.trim()
    // A search ranks by relevance (title first, then contents), and equal matches by the sort order.
    if (q) {
      const search = await this.search(read)
      // The library changed while the index was being built: search what's there now.
      return search ? search(rows, q) : this.listDiagrams(filter)
    }
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
    return buildTagTree(rows, this.workspace.tagEmoji.toJSON())
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
      starred: !!this.workspace.starred.get(id),
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }
  }

  async createDiagram(input: { title?: string; source?: string; tags?: string[] } = {}, actor: Actor = USER): Promise<DiagramId> {
    const id = crypto.randomUUID()
    const doc = newDiagramDoc()
    const meta = doc.getMap("meta")
    meta.set("title", input.title?.trim() || "Untitled")
    meta.set("createdAt", Date.now())
    setTags(meta, normalizeTags(input.tags ?? []))
    doc.getText("source").insert(0, lf(input.source ?? "flowchart TD\n  A[Start] --> B[End]\n"))
    commit(doc, actor)
    await compact(this.db, id, doc, () => this.indexRow(id, doc))
    this.indexChanged(id)
    return id
  }

  /**
   * Changes title, source and tags. Title and tags are details, on nobody's undo stack;
   * the source change is undoable. With `base`, the version the source was read at, the
   * edits that turn that version into the source are merged by Loro with anything changed
   * since (e.g. the person typing while an agent worked), as another tab's edits would be.
   */
  async editDiagram(
    id: DiagramId,
    edit: { title?: string; source?: string; addTags?: string[]; removeTags?: string[] },
    actor: Actor = USER,
    { base }: { base?: string } = {}
  ) {
    if (edit.source !== undefined) edit = { ...edit, source: lf(edit.source) }
    await this.mutate(id, actor, (d) => {
      // Merge the source first: forking the doc commits it, which would otherwise save this
      // edit's other changes early, without their label.
      const merged = edit.source !== undefined && base && base !== encodeVersion(d.doc) ? mergeFromBase(d, base, edit.source) : null
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
      if (merged) d.text.applyDelta(merged)
      else if (edit.source !== undefined) applyEdits(d.text, diffText(sourceOf(d), edit.source))
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
            const changes = changesOf(event.diff.diff)
            if (changes.length) listener(changes)
          }
        }),
      select: (anchor, head) => {
        const cursors = [d.text.getCursor(anchor), d.text.getCursor(head)]
        d.selection.cursors = cursors.every((c) => c !== undefined) ? cursors : []
      },
      onSelect: (listener) => {
        d.selection.listeners.add(listener)
        return () => d.selection.listeners.delete(listener)
      },
    }
  }

  async setSource(id: DiagramId, source: string, actor: Actor = USER) {
    await this.mutate(id, actor, (d) => applyEdits(d.text, diffText(sourceOf(d), lf(source))))
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
    // Label the commit the undo manager makes, so the other stack ignores it and history credits the right actor.
    d.doc.setNextCommitOptions({ origin: actorOrigin(by), message: JSON.stringify(by) })
    const done = stack[dir]()
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
    const d = await this.openDiagram(id)
    const frontiers = frontiersOf(d, version) // checked first, so an unknown version clears nothing
    // The restore reverses edits still on the other actor's stack; undoing one would apply its reversal twice.
    if (version !== encodeVersion(d.doc)) (actor.kind === "agent" ? d.undo : d.agentUndo).clear()
    await this.mutate(id, actor, (e) => e.doc.revertTo(frontiers))
  }

  // ── Organisation ───────────────────────────────────────────────────────────

  async setStarred(ids: Ids, starred: boolean, actor: Actor = USER) {
    // A workspace change only (see withStar): no row is written, and other tabs hear the workspace's update.
    try {
      await this.each(ids, async (id) => {
        // A missing diagram isn't left a star.
        if (!(await this.db.get("diagrams", id))) throw new Error(`Diagram ${id} not found`)
        if (starred) this.workspace.starred.set(id, true)
        else this.workspace.starred.delete(id)
        this.emit("library", `diagram:${id}`)
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
      const rows = await this.db.getAll("diagrams")
      const had = new Set(rows.map((r) => r.id))
      const hadTags = new Set(rows.flatMap((r) => r.tagPrefixes))
      let tagEmoji: Record<string, Value> = {}
      // Imported ops aren't local updates, so persistDoc neither saves nor broadcasts them:
      // each import below saves its doc whole and sends the ops to other tabs itself.
      if (workspace) {
        this.workspace.doc.import(workspace)
        await compact(this.db, WORKSPACE_ID, this.workspace.doc)
        this.broadcast({ type: "update", id: WORKSPACE_ID, bytes: workspace })
        // A wipe's deletes (this replace's, or an earlier Delete all's) are newer than the backup's
        // stars and emoji, so they'd win: set them again, as changes made now, but only for the
        // diagrams and tags the library didn't have, so those it has keep any change made since.
        // Only the diagrams the backup brings get their stars back, so a star with no diagram stays gone.
        const backup = new LoroDoc()
        backup.import(workspace)
        for (const { id } of diagrams) if (!had.has(id) && backup.getMap("starred").get(id)) this.workspace.starred.set(id, true)
        tagEmoji = backup.getMap("tagEmoji").toJSON() as Record<string, Value>
        backup.free()
        commit(this.workspace.doc, { kind: "import", source: "backup" })
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
      // Emoji only for the tags the backup brought back, so a tag deleted since doesn't get its emoji again.
      const tags = new Set((await this.db.getAll("diagrams")).flatMap((r) => r.tagPrefixes))
      for (const [tag, emoji] of Object.entries(tagEmoji)) if (tags.has(tag) && !hadTags.has(tag)) this.workspace.tagEmoji.set(tag, emoji)
      commit(this.workspace.doc, { kind: "import", source: "backup" })
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

  /** Imports a shared diagram, or returns an existing one with the same title and source (line endings aside, whatever its tags). */
  async importShare(shared: SharePayload): Promise<DiagramId> {
    const payload = { ...shared, source: lf(shared.source) }
    const existing = await this.findIdentical(payload.title, payload.source)
    if (existing) return existing
    return this.createDiagram(payload, { kind: "import", source: "share-link" })
  }

  private async findIdentical(title: string, source: string): Promise<DiagramId | null> {
    const candidates = (await this.allRows()).filter(
      // Line breaks aside: a diagram saved before they were normalised can still hold \r.
      (r) => !r.deletedAt && r.title === (title.trim() || "Untitled") && r.sourceText !== undefined && lf(r.sourceText) === source
    )
    // The index can trail an edit by a moment, so check the diagram itself before reusing it.
    for (const row of candidates) if (lf(await this.getSource(row.id)) === source) return row.id
    return null
  }

  /** Permanently removes soft-deleted diagrams. */
  async purge(ids: Ids) {
    try {
      await this.each(ids, async (id) => {
        // Closed only once it's gone: one restored meanwhile stays open, and keeps saving what's typed in it.
        if (!(await deleteDocData(this.db, id))) return
        await this.close(id)
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
        // Each step also keeps the selection from just before it (see SourceBinding.select), which onPop puts back once
        // the step's change is shown. That waits a microtask, as the step's reverse is pushed after onPop with the
        // selection from before it: the one undo or redo is about to move.
        const selection: OpenDiagram["selection"] = { cursors: [], listeners: new Set() }
        const undo = new UndoManager(doc, {
          mergeInterval: MERGE_MS,
          maxUndoSteps: 200,
          excludeOriginPrefixes: ["agent", "import", "system", DETAILS],
          onPush: () => ({ value: null, cursors: selection.cursors }),
          onPop: (_, { cursors: [anchor, head] }) => {
            const at = (c: Cursor | undefined) => c && doc.getCursorPos(c)?.offset
            const [a, h] = [at(anchor), at(head)]
            if (a !== undefined && h !== undefined) queueMicrotask(() => selection.listeners.forEach((listener) => listener(a, h)))
          },
        })
        const agentUndo = new UndoManager(doc, {
          mergeInterval: 0,
          maxUndoSteps: 200,
          excludeOriginPrefixes: ["user", "import", "system", DETAILS],
        })
        const persisted = persistDoc(this.db, id, doc, (bytes) => this.broadcast({ type: "update", id, bytes }))
        const meta = doc.getMap("meta")
        // A title or tag change imported (from another tab, a backup or the saved log) rebuilds the row from the merged
        // doc: another tab saved one from its own copy, which can lack a details change made here at the same time.
        // That sends "index", never "update", so the tabs can't set each other off.
        meta.subscribe(({ by }) => by === "import" && void this.afterChange(id, opened))
        const opened: OpenDiagram = {
          id,
          doc,
          text: doc.getText("source"),
          meta,
          undo,
          agentUndo,
          selection,
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
        return opened
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
   * open. Such changes to one diagram run one at a time, each on what the last one saved.
   * Either way the change is committed, saved,
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

  private refreshIndexSoon(id: DiagramId, d: OpenDiagram) {
    clearTimeout(this.indexTimers.get(id)?.timer)
    const run = () => {
      this.indexTimers.delete(id)
      void this.afterChange(id, d)
    }
    this.indexTimers.set(id, { timer: setTimeout(run, INDEX_MS), run })
  }

  /**
   * When the page goes away: retries a failed write instead of waiting for the next edit, then
   * refreshes pending index rows. The docs go first, as the index can be rebuilt from them. Both
   * are only attempts: the page can die before they land, so a row left behind its doc is
   * rebuilt on the next start (see persistDoc).
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

  /** Runs every pending index refresh now (once saveNow's writes are retried, when the page is hidden or goes away). */
  flushIndex() {
    for (const pending of [...this.indexTimers.values()]) {
      clearTimeout(pending.timer)
      pending.run()
    }
  }

  /** Rebuilds an open diagram's index row. Returns false, writing nothing, if the diagram has been purged. */
  private async afterChange(id: DiagramId, d: OpenDiagram): Promise<boolean> {
    // After the doc's writes, so this row clears the pending marks they leave (see persistDoc).
    await d.persisted.written()
    if (!(await updateRow(this.db, id, (saved) => this.rowOf(id)(d.doc, saved), { fromDoc: true }))) return false
    this.indexChanged(id)
    return true
  }

  /** Builds an existing diagram's index row, keeping whether it's deleted; nothing if it's gone. */
  private rowOf(id: DiagramId): RowBuilder {
    return (doc, saved) => saved && this.indexRow(id, doc, saved.deletedAt)
  }

  private indexRow(id: DiagramId, doc: LoroDoc, deletedAt?: number): StoredRow {
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
      sourcePreview: source.slice(0, 200),
      sourceText: source,
      ...(deletedAt ? { deletedAt } : {}),
    }
  }

  /**
   * Rebuilds the rows marked as behind their docs: a page went away before it rewrote them (see persistDoc).
   * One that fails to save (a full disk) keeps its mark, for the next start, and doesn't stop Eos opening.
   */
  private async repairRows() {
    for (const id of await this.db.getAllKeys("pendingRows")) {
      try {
        if (await compact(this.db, id, newDiagramDoc(), this.rowOf(id))) this.indexChanged(id)
      } catch (error) {
        console.error(`Couldn't rebuild the library row of diagram ${id}`, error)
      }
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

  private async patchIndex(id: DiagramId, patch: Partial<StoredRow>) {
    const patched = await updateRow(this.db, id, (row) => {
      if (!row) return undefined
      const next: StoredRow & { starred?: unknown } = { ...row, ...patch }
      if (patch.deletedAt === undefined && "deletedAt" in patch) delete next.deletedAt
      delete next.starred // left by an older version (see withStar)
      return next
    })
    if (!patched) throw new Error(`Diagram ${id} not found`)
    this.indexChanged(id)
  }

  /**
   * A stored row as it's read, with its star. Invariant: stars live only in the workspace doc.
   * Rows on disk never hold a star (an older row's leftover `starred` is overwritten here), and
   * every read adds it from this tab's workspace, so no row write can save a stale star, and a
   * star change writes no row. Every change to the workspace's stars emits "library".
   */
  private withStar(row: StoredRow): DiagramIndexRow {
    return { ...row, starred: this.workspace.starred.get(row.id) ? 1 : 0 }
  }

  /** Every index row, from the cache when the library hasn't changed since the last read. */
  private allRows(): Promise<DiagramIndexRow[]> {
    const read = (this.rows ??= this.db.getAll("diagrams").then((stored) => {
      // Unchanged rows keep their old object, so views that memoise on a row can skip it.
      const kept = stored.map((raw) => {
        const row = this.withStar(raw)
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
    const differs = (row: StoredRow) => {
      const old = cached.get(row.id)
      return !old || !sameRow(old, this.withStar(row))
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
    // Stars and tag emoji imported (from another tab or a backup), which the library shows. Reads add stars from the
    // workspace (see withStar), so a star needs no row write: the views of each diagram whose star changed are told.
    this.workspace.doc.subscribe(({ by, events }) => {
      if (by !== "import") return
      const starred = events.flatMap((e) =>
        e.target === this.workspace.starred.id && e.diff.type === "map" ? Object.keys(e.diff.updated) : []
      )
      this.emit("library", ...starred.map((id) => `diagram:${id}` as const))
    })
    if (typeof BroadcastChannel === "undefined") return
    this.channel = new BroadcastChannel("eos")
    this.channel.onmessage = async ({ data }: MessageEvent<SyncMessage>) => {
      if (data.type === "settings") {
        this.settingsCache = withDefaults(await this.db.get("settings", "app"))
        this.emit("settings")
      } else if (data.type === "update" && data.id && data.bytes) {
        if (data.id === WORKSPACE_ID) this.workspace.doc.import(data.bytes)
        else {
          // An open diagram's meta subscription rebuilds its row (see openDiagram). Otherwise a diagram's index row
          // changes with the "index" message that follows (once typing pauses).
          if (this.open.has(data.id)) (await this.openDiagram(data.id)).doc.import(data.bytes)
          this.emit(`diagram:${data.id}`)
        }
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

/** A Loro text delta as edits in the coordinates of the text before it, in order: text deleted and inserted at one spot is one replacement. */
function changesOf(delta: Delta<string>[]): TextChange[] {
  const changes: TextChange[] = []
  let pos = 0
  for (const op of delta) {
    const last = changes.at(-1)
    if (op.retain !== undefined) pos += op.retain
    else if (op.delete !== undefined) {
      if (last?.to === pos) last.to += op.delete
      else changes.push({ from: pos, to: pos + op.delete, insert: "" })
      pos += op.delete
    } else if (op.insert !== undefined) {
      if (last?.to === pos) last.insert += op.insert
      else changes.push({ from: pos, to: pos, insert: op.insert })
    }
  }
  return changes
}

/**
 * The edits that turn `a` into `b`, by Loro's diff (`LoroText.update`). By default Loro tidies a
 * minimal diff up for reading (a few kept characters among changes are replaced as well); `exact`
 * keeps it minimal.
 */
function charDiff(a: string, b: string, exact = false): TextChange[] {
  const doc = new LoroDoc()
  const text = doc.getText("source")
  text.insert(0, a)
  doc.commit()
  const from = doc.frontiers()
  text.update(b, { useRefinedDiff: !exact })
  doc.commit()
  const diff = doc.diff(from, doc.frontiers(), false)[0]?.[1]
  doc.free()
  return diff?.type === "text" ? changesOf(diff.diff) : []
}

/** The runs of lines that differ, in order: lines [i0, i1) of `a` become lines [j0, j1) of `b`. */
function lineHunks(a: string[], b: string[]) {
  // Lines that match at the start come first, so of two identical lines it's the first that stays.
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const mid = { i0: pre, i1: a.length - suf, j0: pre, j1: b.length - suf }
  // The lines between, one character each (below the surrogates), so a diff of the two strings is a diff of lines.
  const ids = new Map<string, string>()
  const encode = (lines: string[]) => lines.map((l) => ids.get(l) ?? ids.set(l, String.fromCharCode(0x100 + ids.size)).get(l)!).join("")
  const ea = encode(a.slice(mid.i0, mid.i1))
  const eb = encode(b.slice(mid.j0, mid.j1))
  if (!ea || !eb || ids.size > 0xd800 - 0x100) return ea || eb ? [mid] : []
  const hunks: (typeof mid)[] = []
  let shift = 0 // lines `b` has gained on `a` so far
  for (const e of charDiff(ea, eb, true)) {
    const i0 = pre + e.from
    const last = hunks.at(-1)
    // A removal and an insertion with no line between them are one run.
    if (last?.i1 === i0) {
      last.i1 = pre + e.to
      last.j1 += e.insert.length
    } else hunks.push({ i0, i1: pre + e.to, j0: i0 + shift, j1: i0 + shift + e.insert.length })
    shift += e.insert.length - (e.to - e.from)
  }
  return hunks
}

/**
 * The edits that turn `a` into `b`, line by line. Invariant: lines `b` keeps are left alone, lines it
 * adds or removes go in or come out whole between lines, and only lines it changes get a character
 * diff, so whatever was typed on a kept line stays on that line. Whole lines go in as "  X\n" at the
 * start of a line, or "\n  X" at the end of the text.
 */
function diffText(a: string, b: string): TextChange[] {
  const A = a.split("\n")
  const B = b.split("\n")
  // Where each line starts.
  const starts = (lines: string[]) => {
    const at = [0]
    for (const l of lines) at.push(at.at(-1)! + l.length + 1)
    return at
  }
  const sa = starts(A)
  const sb = starts(B)
  return lineHunks(A, B).flatMap(({ i0, i1, j0, j1 }): TextChange[] => {
    const lines = B.slice(j0, j1).join("\n")
    if (i0 === i1) {
      const at = i0 < A.length ? sa[i0]! : a.length
      return [{ from: at, to: at, insert: i0 < A.length ? lines + "\n" : "\n" + lines }]
    }
    if (j0 === j1) return [i1 < A.length ? { from: sa[i0]!, to: sa[i1]!, insert: "" } : { from: sa[i0]! - 1, to: a.length, insert: "" }]
    // The changed lines' text, without the line break after the last.
    const at = sa[i0]!
    return charDiff(a.slice(at, sa[i1]! - 1), b.slice(sb[j0]!, sb[j1]! - 1)).map((e) => ({ ...e, from: at + e.from, to: at + e.to }))
  })
}

/**
 * The change that turns the text at version `base` into `source`, merged with everything changed
 * since, as a delta on the text now. The edits are made on a copy of the doc at `base`, where
 * diffText's positions are exact, and Loro merges them into a copy of the doc now, as it merges
 * another tab's: what anyone changed since `base` is kept.
 */
function mergeFromBase(d: Editable, base: string, source: string): Delta<string>[] {
  const old = d.doc.forkAt(frontiersOf(d, base))
  const now = d.doc.fork()
  try {
    // The highest peer the doc doesn't have (Loro reserves the maximum), so the edits are new ops to
    // it, and of two insertions at one spot Loro puts the lower peer's first: the agent's go after
    // the person's, whose typing stays next to what it followed.
    const peers = d.doc.oplogVersion()
    let peer = 2n ** 64n - 2n
    while (peers.get(peer) !== undefined) peer--
    old.setPeerId(peer)
    const from = old.oplogVersion()
    const text = old.getText("source")
    applyEdits(text, diffText(text.toString(), source))
    old.commit()
    const before = now.frontiers()
    now.import(old.export({ mode: "update", from }))
    const diff = now.diff(before, now.frontiers(), false).find(([id]) => id === d.text.id)?.[1]
    return diff?.type === "text" ? diff.diff : []
  } finally {
    old.free()
    now.free()
  }
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

/** Whether two reads of an index row (with their stars, see withStar) hold the same values. Rows are flat apart from their tag lists. */
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
