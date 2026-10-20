import { create, insertMultiple, search } from "@orama/orama"

import type { DiagramIndexRow } from "./types"

/** Title matches count this many times more than contents matches. */
const TITLE_BOOST = 3

/** Searches some of the rows an index was built over (see searchIndex). */
export type Search = (rows: DiagramIndexRow[], query: string) => Promise<DiagramIndexRow[]>

/**
 * Fuzzy, typo-tolerant search over titles and contents, best match first. The index is
 * built once over the whole library and kept until the library changes; each search
 * returns only the matches among the rows it's given (the ones the other filters kept).
 */
export async function searchIndex(all: DiagramIndexRow[]): Promise<Search> {
  // Building takes a while (about 70ms for 1000 diagrams). Start it in a task of its own, so the
  // keystroke that asked for it can finish its own work first (the browser may paint in between).
  await new Promise((resolve) => setTimeout(resolve))
  const db = create({ schema: { id: "string", title: "string", source: "string" } as const })
  await insertMultiple(
    db,
    all.map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview }))
  )
  return async (rows, query) => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const result = (await search(db, {
      term: query,
      properties: ["title", "source"],
      boost: { title: TITLE_BOOST },
      tolerance: query.length > 3 ? 1 : 0,
      limit: all.length,
    })) as { hits: { document: { id: string } }[] }
    return result.hits.map((h) => byId.get(h.document.id)).filter((r) => r !== undefined)
  }
}
