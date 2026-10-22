import { create, insertMultiple, search } from "@orama/orama"
import { stemmer } from "@orama/stemmers/english"

import type { DiagramIndexRow } from "./types"

/** Title matches count this many times more than contents matches. */
const TITLE_BOOST = 3
/** Rows indexed per task while building (about 10ms of work). */
const BUILD_SLICE = 100

/** Scripts written without spaces between words, which only a segmenter can split. */
const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u
/** Scripts whose words are a character or a few long (these and Korean), so one typo makes another word. */
const SHORT_WORDS = new RegExp(`${UNSPACED.source}|\\p{sc=Hangul}`, "u")
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" })
/** The words in a run of an unspaced script: every piece holding a letter or digit, not only `isWordLike` ones, for a Firefox bug (tracked in docs/backlog.md) that marks a run that is one word as not word-like. */
const segment = (run: string) => [...segmenter.segment(run)].map((s) => s.segment).filter((s) => /[\p{L}\p{N}]/u.test(s))
/**
 * A word with an apostrophe or hyphen in it, and its parts of 2 or more characters: "sarah's" is also
 * "sarah", "sign-up" also "sign" and "up", and "login--" (from "login-->dashboard") also "login".
 * One-character parts are dropped so "don't" doesn't find every diagram through "t".
 */
const withParts = (w: string) => (/['-]/.test(w) ? [w, ...w.split(/['-]+/).filter((p) => p.length > 1 && /[\p{L}\p{N}]/u.test(p))] : [w])
/**
 * Words in any script, lowercased, with accents (combining marks U+0300–036F) dropped so "resume"
 * finds "Résumé", and curly apostrophes made straight. Every letter is part of a word, so "Straße" or
 * "Привет" is one word, not fragments (Orama's own tokenizer splits on letters outside A-Z and a few
 * accented ones).
 */
const tokenizer = {
  language: "english",
  normalizationCache: new Map<string, string>(),
  tokenize: (raw: string) => {
    // Each distinct word once: a source repeats its words and arrows many times.
    const words = new Set(
      raw
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .split(/[^\p{L}\p{M}\p{N}_'-]+/u)
    )
    const split = [...words].flatMap((w) => (UNSPACED.test(w) ? segment(w) : withParts(w)))
    const folded = split.map((w) =>
      /[^\0-\x7f]/.test(w)
        ? w
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .normalize("NFC")
        : w
    )
    return [...new Set(folded.filter(Boolean))]
  },
}

/**
 * A word's English stem ("payments" and "payment" are both "payment"), for telling whether a diagram has a
 * query word whole. Only that comparison stems: the index and the query keep the words as typed, so a prefix
 * typed so far ("pay", "configurat") still finds the word. Remembers each word's stem in `stems`.
 */
const stem = (stems: Map<string, string>, w: string) => {
  if (!/^[a-z]+$/.test(w)) return w
  let s = stems.get(w)
  if (s === undefined) stems.set(w, (s = stemmer(w)))
  return s
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
  /** Each diagram's words, as the index has them, stemmed. */
  const wordsOf = new Map<string, Set<string>>()
  /** The stems worked out so far, for this index only so they don't pile up for the session. */
  const stems = new Map<string, string>()
  // Building takes a while (about 70ms for 1000 diagrams), so it's done a slice at a time, each
  // in a task of its own: keystrokes that come in meanwhile are handled between slices.
  for (let i = 0; i < all.length; i += BUILD_SLICE) {
    await new Promise((resolve) => setTimeout(resolve))
    if (stale()) return null
    const docs = all.slice(i, i + BUILD_SLICE).map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview }))
    await insertMultiple(db, docs)
    for (const d of docs)
      wordsOf.set(d.id, new Set([...tokenizer.tokenize(d.title), ...tokenizer.tokenize(d.source)].map((w) => stem(stems, w))))
  }
  const find = async (term: string, tolerance: number) =>
    (
      (await search(db, {
        term,
        properties: ["title", "source"],
        boost: { title: TITLE_BOOST },
        tolerance,
        limit: all.length,
      })) as { hits: { score: number; document: { id: string } }[] }
    ).hits
  return async (rows, query) => {
    const position = new Map(rows.map((r, i) => [r.id, i]))
    // A typo is allowed per word: none in a word of a short-word script, one elsewhere once the query is over 3
    // characters. Orama sets tolerance per search and adds up each word's score, so a query with both kinds of
    // word is searched once per kind and the scores are added.
    const tolerance = query.length > 3 ? 1 : 0
    const words = tokenizer.tokenize(query)
    const short = words.filter((w) => SHORT_WORDS.test(w))
    const hits =
      short.length === 0
        ? await find(query, tolerance)
        : short.length === words.length
          ? await find(query, 0)
          : [...(await find(words.filter((w) => !SHORT_WORDS.test(w)).join(" "), tolerance)), ...(await find(short.join(" "), 0))]
    const score = new Map<string, number>()
    for (const h of hits) score.set(h.document.id, (score.get(h.document.id) ?? 0) + h.score)
    // Orama has no penalty for a prefix or typo match: it scores one ("logic", "420") like the word itself
    // ("login", "42"), and higher when it's rarer. Its `exact` option can't stand in, being a case-sensitive
    // post-filter that needs every word in one field. So a diagram ranks first by how many of the query's words
    // it has whole (compared by stem, so "payments" has "payment" whole), then by score (titles boosted); equal
    // ones keep the order the rows came in (the library's sort), not the index's.
    const stemmed = words.map((w) => stem(stems, w))
    const found = (id: string) => stemmed.filter((w) => wordsOf.get(id)!.has(w)).length
    const exact = new Map([...score.keys()].filter((id) => position.has(id)).map((id) => [id, found(id)]))
    return [...exact.keys()]
      .sort((a, b) => exact.get(b)! - exact.get(a)! || score.get(b)! - score.get(a)! || position.get(a)! - position.get(b)!)
      .map((id) => rows[position.get(id)!]!)
  }
}
