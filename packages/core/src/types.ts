export type DiagramId = string
/** Slash-separated, lowercase tag path, e.g. "work/backend". */
export type TagPath = string

export type Actor =
  | { kind: "user" }
  | { kind: "agent"; tool: string }
  | { kind: "import"; source: "share-link" | "backup" }
  | { kind: "system"; reason: string }

export interface DiagramMeta {
  title: string
  tags: TagPath[]
  createdAt: number
}

export interface DiagramIndexRow {
  id: DiagramId
  title: string
  tags: TagPath[]
  /** Every prefix of every tag: "work/backend" → ["work", "work/backend"]. */
  tagPrefixes: TagPath[]
  createdAt: number
  updatedAt: number
  titleKey: string
  starred: 0 | 1
  sourcePreview: string
  deletedAt?: number
}

export interface TagRecord {
  path: TagPath
  emoji: string | null
  count: number
  children: TagRecord[]
}

export type LibrarySort = "modified" | "created" | "title"

export interface LibraryFilter {
  query?: string
  starred?: boolean
  tags?: TagPath[]
  sort?: LibrarySort
  includeDeleted?: boolean
  /** Only diagrams in Recently deleted. */
  deleted?: boolean
}

export type ThemeMode = "system" | "light" | "dark"

export interface AppSettings {
  /** customCss overrides app variables (--eos-*); diagramCss overrides diagram variables (--pele-*). */
  theme: { mode: ThemeMode; customCss: string | null; diagramCss: string | null }
  agent: { webmcpEnabled: boolean; confirmDestructive: boolean }
}

export interface DiagramSnapshot {
  id: DiagramId
  meta: DiagramMeta
  source: string
  starred: boolean
  updatedAt: number
  deletedAt?: number
}

export interface HistoryEntry {
  version: string
  actor: Actor
  at: number
}

export type Result<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; code: ErrorCode; message: string }

export type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "parse_error"
  | "user_declined"
  | "disabled"
  | "stale"
