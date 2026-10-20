import { LoroDoc, LoroList, type LoroMap, type LoroText } from "loro-crdt"

import type { Database } from "./db"
import type { Actor, DiagramId, DiagramIndexRow, DiagramMeta, HistoryEntry, TagPath } from "./types"

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

export function metaOf(d: { meta: LoroMap }): DiagramMeta {
  const json = d.meta.toJSON() as Partial<DiagramMeta>
  return {
    title: typeof json.title === "string" ? json.title : "Untitled",
    tags: Array.isArray(json.tags) ? (json.tags as TagPath[]) : [],
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

export function setTags(meta: LoroMap, tags: TagPath[]) {
  const list = meta.setContainer("tags", new LoroList())
  tags.forEach((tag, i) => list.insert(i, tag))
}

/** Loads a doc from its snapshot plus any logged updates. */
export async function loadDoc(db: Database, id: DiagramId): Promise<LoroDoc> {
  const doc = new LoroDoc()
  doc.setRecordTimestamp(true)
  const snapshot = await db.get("snapshots", id)
  if (snapshot) doc.import(snapshot.bytes)
  const updates = await db.getAllFromIndex("updates", "byDiagram", id)
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
  // instead, which fills the gap.
  const queue = (write: () => Promise<void>) => {
    pending = pending
      .then(async () => {
        if (stopped) return
        if (!gap) return write()
        await compact(db, id, doc)
        gap = false
      })
      .catch((error) => {
        gap = true
        console.error(`Couldn't save a change to diagram ${id}`, error)
      })
  }
  const unsubscribe = doc.subscribeLocalUpdates((bytes) => {
    onLocalUpdate?.(bytes)
    queue(async () => {
      await db.add("updates", { id, bytes, at: Date.now() })
      const count = await db.countFromIndex("updates", "byDiagram", id)
      // Stopped mid-write (by a delete): a snapshot now would write the diagram back.
      if (stopped) return
      if (count > COMPACT_AFTER) await compact(db, id, doc)
    })
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
 * Saves the whole doc as its snapshot and clears its update log. With `row`, its library
 * index row is written in the same transaction, so neither is saved without the other.
 */
export async function compact(db: Database, id: DiagramId, doc: LoroDoc, row?: DiagramIndexRow) {
  const tx = db.transaction(row ? ["snapshots", "updates", "diagrams"] : ["snapshots", "updates"], "readwrite")
  const snapshots = tx.objectStore("snapshots")
  const log = tx.objectStore("updates").index("byDiagram")
  const save = async () => {
    // Another tab may have saved changes this doc hasn't heard of yet, to the snapshot
    // (by compacting) or the log. Take them in first, or this snapshot would drop them.
    const [saved, logged, keys] = await Promise.all([snapshots.get(id), log.getAll(id), log.getAllKeys(id)])
    doc.importBatch([...(saved ? [saved.bytes] : []), ...logged.map((u) => u.bytes)])
    await Promise.all([
      snapshots.put({ id, bytes: doc.export({ mode: "snapshot" }), savedAt: Date.now() }),
      ...keys.map((k) => tx.objectStore("updates").delete(k)),
      row && tx.objectStore("diagrams").put(row),
    ])
  }
  // Awaited with tx.done, so a failed write rejects once instead of leaving done unhandled.
  await Promise.all([save(), tx.done])
}

export async function deleteDocData(db: Database, id: DiagramId) {
  const tx = db.transaction(["snapshots", "updates", "diagrams"], "readwrite")
  await tx.objectStore("snapshots").delete(id)
  const keys = await tx.objectStore("updates").index("byDiagram").getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore("updates").delete(k)))
  await tx.objectStore("diagrams").delete(id)
  await tx.done
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
      if (c.message) actor = JSON.parse(c.message) as Actor
    } catch {
      // Older changes may carry free-form messages; treat them as the user's.
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
