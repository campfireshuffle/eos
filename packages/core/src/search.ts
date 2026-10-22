import { create, insertMultiple, search } from "@orama/orama"

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
 * The parts of a word with an apostrophe or hyphen in it, of 2 or more characters: "sarah's" has "sarah",
 * "sign-up" "sign" and "up", and "login--" (from "login-->dashboard") "login". One-character parts are
 * dropped so "don't" doesn't find every diagram through "t".
 */
const partsOf = (w: string) => (/['-]/.test(w) ? w.split(/['-]+/).filter((p) => p.length > 1 && /[\p{L}\p{N}]/u.test(p)) : [])
/**
 * Words in any script, lowercased, with accents (combining marks U+0300–036F) dropped so "resume"
 * finds "Résumé", and curly apostrophes made straight. Every letter is part of a word, so "Straße" or
 * "Привет" is one word, not fragments (Orama's own tokenizer splits on letters outside A-Z and a few
 * accented ones). With `parts`, a word's parts (see partsOf) follow it.
 */
function wordsIn(raw: string, parts: boolean) {
  // Each distinct word once: a source repeats its words and arrows many times.
  const words = new Set(
    raw
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .split(/[^\p{L}\p{M}\p{N}_'-]+/u)
  )
  const split = [...words].flatMap((w) => (UNSPACED.test(w) ? segment(w) : parts ? [w, ...partsOf(w)] : [w]))
  const folded = split.map((w) =>
    /[^\0-\x7f]/.test(w)
      ? w
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .normalize("NFC")
      : w
  )
  return [...new Set(folded.filter(Boolean))]
}
/**
 * Whether Orama's tokenizer adds a word's parts. The index has them, so "sign" finds "Sign-up flow"; a query's
 * parts are searched apart from it, without typos (see searchIndex), so a query is tokenized without them.
 */
let withParts = true
const tokenizer = { language: "english", normalizationCache: new Map<string, string>(), tokenize: (raw: string) => wordsIn(raw, withParts) }

/** Drops the last letter of a doubled consonant: "runn" (from "running") is "run", "stopp" "stop"; "add" and "call" stay. */
const undouble = (w: string) => (w.length > 3 && /([^aeioulsz])\1$/.test(w) ? w.slice(0, -1) : w)
/**
 * An English word without its plural or verb ending ("payments" and "payment" are both "payment", "creating"
 * and "create" "creat"), for telling whether a diagram has a query word whole. Only those endings: a full
 * stemmer also takes "organization" to "organ" and "using" to "us", which then rank as the words themselves.
 * Only that comparison stems: the index and the query keep the words as typed, so a prefix typed so far
 * ("pay", "configurat") still finds the word.
 */
function stem(w: string) {
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w
  let s = w
  // A plural ending first.
  if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + "y"
  else if (/(ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2)
  else if (/[^isu]s$/.test(s)) s = s.slice(0, -1)
  // Then a verb ending, so "strings" and "string" come out the same.
  if (/ing$/.test(s) && s.length > 5) s = undouble(s.slice(0, -3))
  else if (/ed$/.test(s) && s.length > 4) s = undouble(s.slice(0, -2))
  return s.length > 4 && s.endsWith("e") ? s.slice(0, -1) : s
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
  // Building takes a while (about 70ms for 1000 diagrams), so it's done a slice at a time, each
  // in a task of its own: keystrokes that come in meanwhile are handled between slices.
  for (let i = 0; i < all.length; i += BUILD_SLICE) {
    await new Promise((resolve) => setTimeout(resolve))
    if (stale()) return null
    const docs = all.slice(i, i + BUILD_SLICE).map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview }))
    await insertMultiple(db, docs)
    for (const d of docs) wordsOf.set(d.id, new Set([...tokenizer.tokenize(d.title), ...tokenizer.tokenize(d.source)].map(stem)))
  }
  /** Orama's matches for `term`'s words, which are tokenized without their parts. */
  const find = (term: string, tolerance: number) => {
    // Orama's search is synchronous here (no hooks), so nothing else tokenizes while the flag is off.
    withParts = false
    try {
      const result = search(db, { term, properties: ["title", "source"], boost: { title: TITLE_BOOST }, tolerance, limit: all.length })
      return (result as { hits: { score: number; document: { id: string } }[] }).hits
    } finally {
      withParts = true
    }
  }
  return async (rows, query) => {
    const position = new Map(rows.map((r, i) => [r.id, i]))
    // A typo is allowed per word: none in a word of a short-word script, one elsewhere once the query is over 3
    // characters. Orama sets tolerance per search and adds up each word's score, so a query with both kinds of
    // word is searched once per kind and the scores are added.
    const tolerance = query.length > 3 ? 1 : 0
    const words = wordsIn(query, false)
    const short = words.filter((w) => SHORT_WORDS.test(w))
    const hits =
      short.length === 0
        ? find(query, tolerance)
        : short.length === words.length
          ? find(query, 0)
          : [...find(words.filter((w) => !SHORT_WORDS.test(w)).join(" "), tolerance), ...find(short.join(" "), 0)]
    // Each query word's stem, its parts and their stems.
    const wanted = words.map((w) => ({ stem: stem(w), parts: partsOf(w), partStems: partsOf(w).map(stem) }))
    // Whether a diagram has a query word whole (by stem), or else all of its parts: "follow-up" finds "Follow up".
    const has = (id: string, w: (typeof wanted)[number]) => {
      const own = wordsOf.get(id)!
      return own.has(w.stem) || (w.parts.length > 0 && w.partStems.every((p) => own.has(p)))
    }
    // A query word's parts are searched without typos, and only diagrams with all of them count: "check-in" isn't
    // "check" or "in" one typo away, nor "checkout" and "invoice" (prefixes).
    const split = wanted.filter((w) => w.parts.length > 0)
    if (split.length > 0)
      hits.push(...find(split.flatMap((w) => w.parts).join(" "), 0).filter((h) => split.some((w) => has(h.document.id, w))))
    const score = new Map<string, number>()
    for (const h of hits) score.set(h.document.id, (score.get(h.document.id) ?? 0) + h.score)
    // Orama has no penalty for a prefix or typo match: it scores one ("logic", "420") like the word itself
    // ("login", "42"), and higher when it's rarer. Its `exact` option can't stand in, being a case-sensitive
    // post-filter that needs every word in one field. So a diagram ranks first by how many of the query's words
    // it has whole (see stem and has), then by score (titles boosted); equal ones keep the order the rows came in
    // (the library's sort), not the index's.
    const found = (id: string) => wanted.filter((w) => has(id, w)).length
    const exact = new Map([...score.keys()].filter((id) => position.has(id)).map((id) => [id, found(id)]))
    return [...exact.keys()]
      .sort((a, b) => exact.get(b)! - exact.get(a)! || score.get(b)! - score.get(a)! || position.get(a)! - position.get(b)!)
      .map((id) => rows[position.get(id)!]!)
  }
}
