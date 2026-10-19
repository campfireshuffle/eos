export type DiagramId = string
/** Slash-separated, lowercase tag path, e.g. "work/backend". */
export type TagPath = string

export type Actor =
  | { kind: "user" }
  /** `changes` lists what an agent edit touched (e.g. "source", "tags"), for the history panel. */
  | { kind: "agent"; tool: string; changes?: string[] }
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
  /** Full source for search. Missing on rows written before search indexed it. */
  sourceText?: string
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
  /** Only diagrams in Deleted. */
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

/** One replacement in a text, in the coordinates of the text before the change. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * A live link between an editor and a diagram's source. The editor applies each
 * keystroke with edit(), and hears every other change (other tabs, agents, undo)
 * through onChange as it lands, so concurrent edits merge instead of overwriting.
 */
export interface SourceBinding {
  /** The source as it is now. */
  text(): string
  /** Applies the person's edit. Changes are in ascending order, in the coordinates of text() before the edit. */
  edit(changes: TextChange[]): void
  /** Calls `listener` with each change made by anything other than edit(), in the coordinates of the text before it. */
  onChange(listener: (changes: TextChange[]) => void): () => void
  /**
   * Calls `listener` when the diagram is closed underneath the binding (deleted, or
   * replaced by a backup). edit() then does nothing; bind again to keep editing.
   */
  onClose(listener: () => void): () => void
}

export interface HistoryEntry {
  version: string
  actor: Actor
  at: number
  /** For a run of agent edits collapsed into one entry: everything those edits touched. */
  changes?: string[]
}

export type Result<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string }

export type ErrorCode = "not_found" | "invalid_input" | "parse_error" | "user_declined" | "disabled" | "stale"
