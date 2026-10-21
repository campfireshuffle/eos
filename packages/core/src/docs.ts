import { LoroDoc, LoroList, type LoroMap, type LoroText } from "loro-crdt"
import * as z from "zod/mini"

import type { Database, StoredRow } from "./db"
import type { Actor, DiagramId, DiagramMeta, HistoryEntry, TagPath } from "./types"

/** Compact the update log into a snapshot once it grows past this many rows. */
const COMPACT_AFTER = 200

export interface DiagramDoc {
  id: DiagramId
  doc: LoroDoc
  text: LoroText
  meta: LoroMap
  dispose(): void
}

export function sourceOf(d: { text: LoroText }): string {
  return d.text.toString()
}

/**
 * A diagram's meta. Docs can come from a backup made anywhere, so anything malformed reads as missing.
 * Tags are deduped: two tabs or devices adding the same one at once leave it in the list twice.
 */
export function metaOf(d: { meta: LoroMap }): DiagramMeta {
  const json = d.meta.toJSON() as Record<string, unknown>
  return {
    title: typeof json.title === "string" ? json.title : "Untitled",
    tags: Array.isArray(json.tags) ? [...new Set(json.tags.filter((t): t is TagPath => typeof t === "string"))] : [],
    createdAt: typeof json.createdAt === "number" ? json.createdAt : 0,
  }
}

/** Origin prefix for title and tag changes, which neither undo stack records (see Eos.mutate). */
export const DETAILS = "details:"

/** Commits pending changes, labelled with who made them. Details go on nobody's undo stack. */
export function commit(doc: LoroDoc, actor: Actor, { details = false } = {}) {
  doc.commit({ origin: (details ? DETAILS : "") + actorOrigin(actor), message: JSON.stringify(actor) })
}

export function actorOrigin(actor: Actor): string {
  return actor.kind === "agent" ? `agent:${actor.tool}` : actor.kind
}

/**
 * Edits the tag list in place, deleting the tags not kept and inserting the missing ones where
 * `tags` has them. Concurrent edits to one list merge, so a tag another tab or a merged backup
 * added meanwhile is kept; replacing the list would throw one side's away.
 */
export function setTags(meta: LoroMap, tags: TagPath[]) {
  const found = meta.get("tags")
  const list = found instanceof LoroList ? found : meta.setContainer("tags", new LoroList())
  const keep = new Set<unknown>(tags)
  const items = list.toArray()
  // Back to front, so the indexes still to visit don't shift. Drops repeats too.
  for (let i = items.length - 1; i >= 0; i--) if (!keep.has(items[i]) || items.indexOf(items[i]) < i) list.delete(i, 1)
  const have = new Set(list.toArray())
  tags.forEach((tag, i) => {
    if (!have.has(tag)) list.insert(Math.min(i, list.length), tag)
  })
}

/**
 * A new, empty diagram doc. Every commit keeps its own timestamp: Loro would otherwise merge a
 * peer's commits with the same message for up to 1,000 seconds into one change, dated by the
 * first, and history would show a later edit at an earlier time (history folds them itself).
 */
export function newDiagramDoc(): LoroDoc {
  const doc = new LoroDoc()
  doc.setRecordTimestamp(true)
  doc.setChangeMergeInterval(0)
  return doc
}

/** Loads a doc from its snapshot plus any logged updates. */
export async function loadDoc(db: Database, id: DiagramId): Promise<LoroDoc> {
  const doc = newDiagramDoc()
  // One transaction, so another tab's compact can't move the log into the snapshot between the reads.
  const tx = db.transaction(["snapshots", "updates"], "readonly")
  const [snapshot, updates] = await Promise.all([
    tx.objectStore("snapshots").get(id),
    tx.objectStore("updates").index("byDiagram").getAll(id),
    tx.done,
  ])
  if (snapshot) doc.import(snapshot.bytes)
  for (const u of updates) doc.import(u.bytes)
  return doc
}

export interface Persisted {
  /** Stops saving: anything still queued is dropped too. */
  stop(): void
  /** If the last write failed, saves the whole doc now instead of with the next change. */
  retry(): void
}

/** Appends every local change to the update log; compacts when it gets long. */
export function persistDoc(db: Database, id: DiagramId, doc: LoroDoc, onLocalUpdate?: (bytes: Uint8Array) => void): Persisted {
  let pending = Promise.resolve()
  let stopped = false
  /** A write failed, so the log is missing an update that every later one builds on. */
  let gap = false
  // Each write waits for the previous one; a failed write is logged and the queue
  // carries on, so one bad write (quota, a closed connection) can't silently stop
  // every later change from saving. The write after a failure saves the whole doc
  // instead, which fills the gap. `saved` runs once the write is done, whether or not it worked.
  const queue = (write: () => Promise<void>, saved?: () => void) => {
    pending = pending
      .then(async () => {
        if (stopped) return
        try {
          if (!gap) return await write()
          await compact(db, id, doc)
          gap = false
        } finally {
          saved?.()
        }
      })
      .catch((error) => {
        gap = true
        console.error(`Couldn't save a change to diagram ${id}`, error)
      })
  }
  // Other tabs hear of an update once it's on disk: one that opens the doc before then reads it
  // from disk without the update, and would ignore the message too if it came earlier.
  const unsubscribe = doc.subscribeLocalUpdates((bytes) => {
    queue(
      async () => {
        await db.add("updates", { id, bytes, at: Date.now() })
        const count = await db.countFromIndex("updates", "byDiagram", id)
        // Stopped mid-write (by a delete): a snapshot now would write the diagram back.
        if (stopped) return
        if (count > COMPACT_AFTER) await compact(db, id, doc)
      },
      () => onLocalUpdate?.(bytes)
    )
  })
  return {
    stop: () => {
      stopped = true
      unsubscribe()
    },
    retry: () => {
      if (gap) queue(async () => {})
    },
  }
}

/**
 * Builds a diagram's library index row from its doc and the row saved now (undefined if there
 * is none), or returns undefined to write nothing. It runs inside the transaction that writes
 * the row, so it sees the latest saved row (another tab's delete, say) and can't race a purge.
 */
export type RowBuilder = (doc: LoroDoc, saved: StoredRow | undefined) => StoredRow | undefined

/**
 * Saves the whole doc as its snapshot and clears its update log. With `row`, its library
 * index row is built and written in the same transaction, so neither is saved without the
 * other: if `row` returns nothing (the diagram was purged, say), nothing is written.
 * Returns whether it saved.
 */
export async function compact(db: Database, id: DiagramId, doc: LoroDoc, row?: RowBuilder): Promise<boolean> {
  const tx = db.transaction(row ? ["snapshots", "updates", "diagrams"] : ["snapshots", "updates"], "readwrite")
  const snapshots = tx.objectStore("snapshots")
  const log = tx.objectStore("updates").index("byDiagram")
  const save = async () => {
    // Another tab may have saved changes this doc hasn't heard of yet, to the snapshot
    // (by compacting) or the log. Take them in first, or this snapshot would drop them.
    const [saved, logged, keys, savedRow] = await Promise.all([
      snapshots.get(id),
      log.getAll(id),
      log.getAllKeys(id),
      row && tx.objectStore("diagrams").get(id),
    ])
    // One at a time: Loro takes a batch of several that brings in new changes as a checkout,
    // which empties an open doc's undo stacks and breaks them until its next local edit.
    if (saved) doc.import(saved.bytes)
    for (const u of logged) doc.import(u.bytes)
    const next = row?.(doc, savedRow)
    if (row && !next) return false
    await Promise.all([
      snapshots.put({ id, bytes: doc.export({ mode: "snapshot" }), savedAt: Date.now() }),
      ...keys.map((k) => tx.objectStore("updates").delete(k)),
      next && tx.objectStore("diagrams").put(next),
    ])
    return true
  }
  // Awaited with tx.done, so a failed write rejects once instead of leaving done unhandled.
  const [saved] = await Promise.all([save(), tx.done])
  return saved
}

/**
 * Rewrites a diagram's library index row from the one saved now, in one transaction, so a
 * change made meanwhile (another tab's delete, say) isn't overwritten by an older copy.
 * `update` returns undefined to write nothing. Returns whether it wrote.
 */
export async function updateRow(
  db: Database,
  id: DiagramId,
  update: (saved: StoredRow | undefined) => StoredRow | undefined
): Promise<boolean> {
  const tx = db.transaction("diagrams", "readwrite")
  const write = async () => {
    const next = update(await tx.store.get(id))
    if (next) await tx.store.put(next)
    return !!next
  }
  const [written] = await Promise.all([write(), tx.done])
  return written
}

/**
 * Deletes a diagram for good, but only if it's in Deleted: checked in the same transaction, so one
 * restored meanwhile (by another tab or an agent, while a confirm was open) is kept. Returns
 * whether it was deleted.
 */
export async function deleteDocData(db: Database, id: DiagramId): Promise<boolean> {
  const tx = db.transaction(["snapshots", "updates", "diagrams"], "readwrite")
  const row = await tx.objectStore("diagrams").get(id)
  if (!row?.deletedAt) {
    await tx.done
    return false
  }
  await tx.objectStore("snapshots").delete(id)
  const keys = await tx.objectStore("updates").index("byDiagram").getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore("updates").delete(k)))
  await tx.objectStore("diagrams").delete(id)
  await tx.done
  return true
}

export function encodeVersion(doc: LoroDoc): string {
  return doc
    .frontiers()
    .map((f) => `${f.peer}:${f.counter}`)
    .join(",")
}

export function decodeVersion(version: string): { peer: `${number}`; counter: number }[] {
  return version
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [peer, counter] = part.split(":")
      return { peer: peer as `${number}`, counter: Number(counter) }
    })
}

/** Edits by the same actor within this window collapse into one history entry. */
const HISTORY_SESSION_MS = 2 * 60_000

export function historyOf(doc: LoroDoc, limit = 50): HistoryEntry[] {
  const changes = [...doc.getAllChanges().values()].flat().sort((a, b) => a.lamport - b.lamport)
  const entries: HistoryEntry[] = []
  for (const c of changes) {
    let actor: Actor = { kind: "user" }
    try {
      // Older changes may carry free-form messages, and a backup can carry anything; treat those as the user's.
      if (c.message) actor = ActorSchema.safeParse(JSON.parse(c.message)).data ?? actor
    } catch {
      // Not JSON: a free-form message.
    }
    const entry: HistoryEntry = { version: `${c.peer}:${c.counter + c.length - 1}`, actor, at: (c.timestamp ?? 0) * 1000 }
    if (actor.kind === "agent") entry.changes = actor.changes ?? []
    const prev = entries.at(-1)
    if (prev && sameActor(prev.actor, actor) && entry.at - prev.at < HISTORY_SESSION_MS) {
      prev.version = entry.version
      prev.at = entry.at
      prev.actor = actor
      if (entry.changes) prev.changes = [...new Set([...(prev.changes ?? []), ...entry.changes])]
    } else entries.push(entry)
  }
  return entries.reverse().slice(0, limit)
}

/** A commit message, as commit writes it. */
const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), tool: z.string(), changes: z.optional(z.array(z.string())) }),
  z.object({ kind: z.literal("import"), source: z.enum(["share-link", "backup"]) }),
  z.object({ kind: z.literal("system"), reason: z.string() }),
])

/** Agent edits group together whichever tool made them; they never group with the person's edits. */
function sameActor(a: Actor, b: Actor): boolean {
  if (a.kind === "agent" && b.kind === "agent") return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Last change time in ms, or 0. */
export function lastChangeAt(doc: LoroDoc): number {
  let latest = 0
  for (const [, changes] of doc.getAllChanges()) for (const c of changes) latest = Math.max(latest, c.timestamp ?? 0)
  return latest * 1000
}
