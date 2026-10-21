import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import type { AppSettings, DiagramId, DiagramIndexRow } from "./types"

/**
 * A `diagrams` row as stored: a DiagramIndexRow without its star. Stars live only in the
 * workspace doc, and reads add them (see Eos.withStar); rows saved by older versions may still
 * carry a `starred` field, which reads ignore.
 */
export type StoredRow = Omit<DiagramIndexRow, "starred">

export interface EosDB extends DBSchema {
  snapshots: {
    key: DiagramId
    value: { id: DiagramId; bytes: Uint8Array; savedAt: number }
  }
  updates: {
    key: number
    value: { id: DiagramId; bytes: Uint8Array; at: number }
    indexes: { byDiagram: DiagramId }
  }
  diagrams: {
    key: DiagramId
    value: StoredRow
    indexes: { byUpdatedAt: number; byTag: string }
  }
  settings: { key: "app"; value: AppSettings }
}

export type Database = IDBPDatabase<EosDB>

/** Reserved id for the workspace doc (stars, tag emoji). */
export const WORKSPACE_ID = "__workspace"

export interface OpenHooks {
  /** Another tab still has an older version open, so the upgrade is waiting for it. */
  onBlocked?: () => void
  /** A newer version of Eos in another tab needs this connection closed. */
  onVersionChange?: () => void
}

export async function openEosDB(name = "eos", hooks: OpenHooks = {}): Promise<Database> {
  const db = await openDB<EosDB>(name, 2, {
    blocked: () => hooks.onBlocked?.(),
    // Never hold up a newer tab's upgrade: close, then let the app decide (it reloads).
    blocking: () => {
      db.close()
      hooks.onVersionChange?.()
    },
    upgrade(db, oldVersion) {
      // v1 had a thumbnails cache; Pele renders cards fast enough that it was never used.
      if (oldVersion === 1) (db as unknown as IDBPDatabase).deleteObjectStore("thumbnails")
      if (oldVersion >= 1) return
      db.createObjectStore("snapshots", { keyPath: "id" })
      const updates = db.createObjectStore("updates", { autoIncrement: true })
      updates.createIndex("byDiagram", "id")
      const diagrams = db.createObjectStore("diagrams", { keyPath: "id" })
      diagrams.createIndex("byUpdatedAt", "updatedAt")
      diagrams.createIndex("byTag", "tagPrefixes", { multiEntry: true })
      db.createObjectStore("settings")
    },
  })
  return db
}
