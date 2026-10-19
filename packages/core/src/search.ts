import { create, insertMultiple, search } from "@orama/orama"

import type { DiagramIndexRow } from "./types"

/** Title matches count this many times more than contents matches. */
const TITLE_BOOST = 3

/**
 * Fuzzy, typo-tolerant search over titles and contents, best match first.
 * Libraries are small, so the index is built per query rather than kept in sync.
 */
export async function searchRows(rows: DiagramIndexRow[], query: string): Promise<DiagramIndexRow[]> {
  const db = create({ schema: { id: "string", title: "string", source: "string" } as const })
  await insertMultiple(
    db,
    rows.map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview }))
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const result = (await search(db, {
    term: query,
    properties: ["title", "source"],
    boost: { title: TITLE_BOOST },
    tolerance: query.length > 3 ? 1 : 0,
    limit: rows.length,
  })) as { hits: { document: { id: string } }[] }
  return result.hits.map((h) => byId.get(h.document.id)!).filter(Boolean)
}
