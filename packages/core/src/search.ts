import MiniSearch, { type Query } from "minisearch"
import { stemmer } from "stemmer"

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
 * "Привет" is one word, not fragments. With `parts`, a word's parts (see partsOf) follow it: the index
 * has them, so "sign" finds "Sign-up flow"; a query's parts are searched apart from it (see searchIndex).
 */
function wordsIn(raw: string, parts: boolean) {
  // Each distinct word once: a source repeats its words and arrows many times.
  const words = new Set(
    raw
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .split(/[^\p{L}\p{M}\p{N}_'-]+/u)
  )
  const split = [...words].flatMap((w) => (UNSPACED.test(w) ? segment(w) : parts ? [w, ...partsOf(w)] : [w]))
  const folded = split.map((w) => (/[^\0-\x7f]/.test(w) ? w.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC") : w))
  return [...new Set(folded.filter(Boolean))]
}

/**
 * An English word's stem term: "~" and its Porter stem, so "cookies" and "cookie" are both "~cooki", "creating"
 * and "create" "~creat". The "~" keeps stems apart from words, so "organ" doesn't match "organization" (stem
 * "organ") as a whole word. Null for a word with anything but a-z in it.
 */
const stemOf = (w: string) => (/^[a-z]+$/.test(w) ? "~" + stemmer(w) : null)
/** A word as the index has it: the word itself, and its stem term beside it. */
const indexTerms = (w: string) => {
  const s = stemOf(w)
  return s ? [w, s] : w
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
  const index = new MiniSearch<{ id: string; title: string; source: string }>({
    fields: ["title", "source"],
    tokenize: (text) => wordsIn(text, true),
    processTerm: indexTerms,
    // A query is split into words below, each its own subquery.
    searchOptions: { tokenize: (text) => [text], processTerm: (term) => term },
  })
  // Building takes a while (about 70ms for 1000 diagrams), so it's done a slice at a time, each
  // in a task of its own: keystrokes that come in meanwhile are handled between slices.
  for (let i = 0; i < all.length; i += BUILD_SLICE) {
    await new Promise((resolve) => setTimeout(resolve))
    if (stale()) return null
    index.addAll(all.slice(i, i + BUILD_SLICE).map((r) => ({ id: r.id, title: r.title, source: r.sourceText ?? r.sourcePreview })))
  }
  return async (rows, query) => {
    const position = new Map(rows.map((r, i) => [r.id, i]))
    const words = wordsIn(query, false)
    // A typo is allowed per word: none in a word of a short-word script, one elsewhere once the query is over 3
    // characters. MiniSearch scores a prefix or typo match below the word itself.
    const typo = query.length > 3 ? 1 : 0
    const queries: Query[] = words.flatMap((w) => {
      const q: Query[] = [{ queries: [w], prefix: true, fuzzy: SHORT_WORDS.test(w) ? false : typo }]
      // The word's stem, only whole: "cookie" finds "Cookies", "query" "queries".
      const s = stemOf(w)
      if (s) q.push({ queries: [s], prefix: false, fuzzy: false })
      // A hyphenated word's parts, all of them whole, at half weight: "follow-up" finds "Follow up", and "check-in"
      // isn't "check" or "in" one typo away, nor "checkout" and "invoice" (prefixes).
      const parts = partsOf(w)
      if (parts.length > 0)
        q.push({ queries: parts, combineWith: "AND", prefix: false, fuzzy: false, boost: { title: TITLE_BOOST / 2, source: 0.5 } })
      return q
    })
    const results = index.search({ combineWith: "OR", queries }, { boost: { title: TITLE_BOOST } })
    // A diagram ranks first by how many of the query's words it has whole, as the word or its stem (MiniSearch
    // reports the terms that matched), so a rare typo or prefix neighbour ("logic", "420") never outranks the word
    // itself ("login", "42"). Then by score (titles boosted); equal ones keep the order the rows came in (the
    // library's sort), not the index's.
    const whole = (terms: string[]) => words.filter((w) => terms.includes(w) || terms.includes(stemOf(w) ?? "")).length
    return results
      .filter((r) => position.has(r.id))
      .map((r) => ({ id: r.id as string, whole: whole(r.terms), score: r.score }))
      .sort((a, b) => b.whole - a.whole || b.score - a.score || position.get(a.id)! - position.get(b.id)!)
      .map((r) => rows[position.get(r.id)!]!)
  }
}
