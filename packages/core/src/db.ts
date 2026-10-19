import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import type { AppSettings, DiagramId, DiagramIndexRow } from "./types"

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
    value: DiagramIndexRow
    indexes: { byUpdatedAt: number; byTag: string }
  }
  settings: { key: "app"; value: AppSettings }
}

export type Database = IDBPDatabase<EosDB>

/** Reserved id for the workspace doc (stars, tag emoji). */
export const WORKSPACE_ID = "__workspace"

export function openEosDB(name = "eos"): Promise<Database> {
  return openDB<EosDB>(name, 2, {
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
}
