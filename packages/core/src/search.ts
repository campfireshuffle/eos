import { create, insertMultiple, search } from "@orama/orama"

import type { DiagramIndexRow } from "./types"

/** Title matches count this many times more than contents matches. */
const TITLE_BOOST = 3
/** Rows indexed per task while building (about 10ms of work). */
const BUILD_SLICE = 100

/** Scripts written without spaces between words, which only a segmenter can split. */
const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u
/** Absent in older engines (Firefox before 125), where such a run stays one word. */
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null
/**
 * Words in any script, lowercased, with Latin accents dropped so "resume" finds "Résumé". Every
 * letter is part of a word, so "Straße" or "Привет" is one word, not fragments (Orama's own
 * tokenizer splits on letters outside A-Z and a few accented ones).
 */
const tokenizer = {
  language: "english",
  normalizationCache: new Map<string, string>(),
  tokenize: (raw: string) => {
    const words = raw.toLowerCase().split(/[^\p{L}\p{M}\p{N}_'-]+/u)
    const split = words.flatMap((w) =>
      segmenter && UNSPACED.test(w) ? [...segmenter.segment(w)].filter((s) => s.isWordLike).map((s) => s.segment) : [w]
    )
    return [
      ...new Set(
        split
          .map((w) =>
            w
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .normalize("NFC")
          )
          .filter(Boolean)
      ),
    ]
  },
}

/** Searches some of the rows an index was built over (see searchIndex). */
export type Search = (rows: DiagramIndexRow[], query: string) => Promise<DiagramIndexRow[]>

/**
 * Fuzzy, typo-tolerant search over titles and contents, best match first. The index is
 * built once over the whole library and kept until the library changes; each search
 * returns only the matches among the rows it's given (the ones the other filters kept).
 * Returns null, having stopped early, once `stale` says the index is no longer wanted.
 */
export async function searchIndex(all: DiagramIndexRow[], stale: () => boolean = () => false): Promise<Search | null> {
  const db = create({ schema: { id: "string", title: "string", source: "string" } as const, components: { tokenizer } })
  // Building takes a while (about 70ms for 1000 diagrams), so it's done a slice at a time, each
  // in a task of its own: keystrokes that come in meanwhile are handled between slices.
  for (let i = 0; i < all.length; i += BUILD_SLICE) {
    await new Promise((resolve) => setTimeout(resolve))
    if (stale()) return null
    await insertMultiple(
      db,
      all.slice(i, i + BUILD_SLICE).map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview }))
    )
  }
  return async (rows, query) => {
    const position = new Map(rows.map((r, i) => [r.id, i]))
    const result = (await search(db, {
      term: query,
      properties: ["title", "source"],
      boost: { title: TITLE_BOOST },
      tolerance: query.length > 3 ? 1 : 0,
      limit: all.length,
    })) as { hits: { score: number; document: { id: string } }[] }
    // Equal scores keep the order the rows came in (the library's sort), not the index's.
    return result.hits
      .filter((h) => position.has(h.document.id))
      .sort((a, b) => b.score - a.score || position.get(a.document.id)! - position.get(b.document.id)!)
      .map((h) => rows[position.get(h.document.id)!]!)
  }
}
