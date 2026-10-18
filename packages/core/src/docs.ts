import { LoroDoc, LoroList, type LoroMap, type LoroText } from "loro-crdt"

import type { Database } from "./db"
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

export function metaOf(d: { meta: LoroMap }): DiagramMeta {
  const json = d.meta.toJSON() as Partial<DiagramMeta>
  return {
    title: typeof json.title === "string" ? json.title : "Untitled",
    tags: Array.isArray(json.tags) ? (json.tags as TagPath[]) : [],
    createdAt: typeof json.createdAt === "number" ? json.createdAt : 0,
  }
}

export function commit(doc: LoroDoc, actor: Actor) {
  doc.commit({ origin: actorOrigin(actor), message: JSON.stringify(actor) })
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

/** Appends every local change to the update log; compacts when it gets long. */
export function persistDoc(
  db: Database,
  id: DiagramId,
  doc: LoroDoc,
  onLocalUpdate?: (bytes: Uint8Array) => void,
): () => void {
  let pending = Promise.resolve()
  const unsubscribe = doc.subscribeLocalUpdates((bytes) => {
    onLocalUpdate?.(bytes)
    pending = pending.then(async () => {
      await db.add("updates", { id, bytes, at: Date.now() })
      const count = await db.countFromIndex("updates", "byDiagram", id)
      if (count > COMPACT_AFTER) await compact(db, id, doc)
    })
  })
  return unsubscribe
}

export async function compact(db: Database, id: DiagramId, doc: LoroDoc) {
  const tx = db.transaction(["snapshots", "updates"], "readwrite")
  await tx.objectStore("snapshots").put({ id, bytes: doc.export({ mode: "snapshot" }), savedAt: Date.now() })
  const keys = await tx.objectStore("updates").index("byDiagram").getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore("updates").delete(k)))
  await tx.done
}

export async function deleteDocData(db: Database, id: DiagramId) {
  const tx = db.transaction(["snapshots", "updates", "diagrams", "thumbnails"], "readwrite")
  await tx.objectStore("snapshots").delete(id)
  const keys = await tx.objectStore("updates").index("byDiagram").getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore("updates").delete(k)))
  await tx.objectStore("diagrams").delete(id)
  await tx.objectStore("thumbnails").delete(id)
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

export function historyOf(doc: LoroDoc, limit = 50): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  for (const [, changes] of doc.getAllChanges()) {
    for (const c of changes) {
      let actor: Actor = { kind: "user" }
      try {
        if (c.message) actor = JSON.parse(c.message) as Actor
      } catch {
        // Older changes may carry free-form messages; treat them as the user's.
      }
      entries.push({
        version: `${c.peer}:${c.counter + c.length - 1}`,
        actor,
        at: (c.timestamp ?? 0) * 1000,
      })
    }
  }
  return entries.sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Last change time in ms, or 0. */
export function lastChangeAt(doc: LoroDoc): number {
  let latest = 0
  for (const [, changes] of doc.getAllChanges()) for (const c of changes) latest = Math.max(latest, c.timestamp ?? 0)
  return latest * 1000
}
