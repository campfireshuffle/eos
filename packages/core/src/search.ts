import MiniSearch, { type Query } from "minisearch"
import pluralize from "pluralize"

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

/** Drops the last letter of a doubled consonant: "runn" (from "running") is "run", "shipp" "ship"; "add" and "call" stay. */
const undouble = (w: string) => (w.length > 3 && /([^aeioulsz])\1$/.test(w) ? w.slice(0, -1) : w)
/**
 * The forms of an English word that count as the word whole, each as a term of its own: "~" and the word's
 * singular, from pluralize ("statuses" and "status" are both "~status", "policies" "~policy"), and for a word
 * ending in -ing or -ed the forms it may come from ("creating" is "~creat", "~create"; "running" "~runn",
 * "~runne", "~run"). Only those endings: "experiment" isn't "experience", nor "organization" "organ". The "~"
 * puts these terms in a namespace of their own, searched only exactly (see searchIndex): a word's
 * prefix ("organ", "creat") never matches one, and one never matches a word. None for a word with anything
 * but a-z in it ("k8s", "v2").
 */
function formsOf(w: string) {
  if (!/^[a-z]+$/.test(w)) return []
  // Not a pronoun's or verb's other person, which pluralize also gives: "us" isn't "me", nor "are" "is".
  const singular = pluralize.singular(w)
  const one = singular[0] === w[0] ? singular : w
  const forms = new Set([one])
  // pluralize takes some -ies plurals to -y ("cookies" to "cooky"), so a plural's form without its s counts too.
  if (one !== w && w.endsWith("s")) forms.add(w.slice(0, -1))
  // A stem of 3 letters or more with a vowel, so "string" isn't "str" nor "thing" "th".
  const verb = /^(.{3,})(?:ing|ed)$/.exec(one)
  if (verb && /[aeiouy]/.test(verb[1]!))
    forms
      .add(verb[1]!)
      .add(verb[1] + "e")
      .add(undouble(verb[1]!))
  return [...forms].map((f) => "~" + f)
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
  // Each word as the index has it: itself and its forms. Kept per word, since a library repeats its words a lot.
  const terms = new Map<string, string[]>()
  const indexTerms = (w: string) => terms.get(w) ?? terms.set(w, [w, ...formsOf(w)]).get(w)!
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
    const found = new Map<string, { score: number; words: number; whole: number }>()
    // Each word is searched on its own, so it counts once however many terms it's searched as.
    for (const w of words) {
      const forms = formsOf(w)
      const queries: Query[] = [{ queries: [w], prefix: true, fuzzy: SHORT_WORDS.test(w) ? false : typo }]
      // The word's forms, only whole: "cookie" finds "Cookies", "query" "queries".
      if (forms.length > 0) queries.push({ queries: forms, prefix: false, fuzzy: false })
      // A hyphenated word's parts, all of them whole, at half weight: "follow-up" finds "Follow up", and "check-in"
      // isn't "check" or "in" one typo away, nor "checkout" and "invoice" (prefixes).
      const parts = partsOf(w)
      if (parts.length > 0)
        queries.push({ queries: parts, combineWith: "AND", prefix: false, fuzzy: false, boost: { title: TITLE_BOOST / 2, source: 0.5 } })
      for (const r of index.search({ combineWith: "OR", queries }, { boost: { title: TITLE_BOOST } })) {
        if (!position.has(r.id)) continue
        const f = found.get(r.id) ?? { score: 0, words: 0, whole: 0 }
        // MiniSearch sums the terms' scores and multiplies by how many matched; this is their mean, so an English
        // word, searched as itself and its forms, weighs what "用户", "k8s" or "42" does, searched only as itself.
        f.score += r.score / r.queryTerms.length ** 2
        f.words++
        // Whole: as the word itself or one of its forms (MiniSearch reports the terms that matched).
        if (r.terms.includes(w) || forms.some((t) => r.terms.includes(t))) f.whole++
        found.set(r.id, f)
      }
    }
    // A diagram ranks first by how many of the query's words it has whole, so a rare typo or prefix neighbour
    // ("logic", "420") never outranks the word itself ("login", "42"). Then by score times how many of the words it
    // has at all (as MiniSearch does per term), titles boosted; equal ones keep the order the rows came in (the
    // library's sort), not the index's.
    return [...found]
      .sort(([a, x], [b, y]) => y.whole - x.whole || y.score * y.words - x.score * x.words || position.get(a)! - position.get(b)!)
      .map(([id]) => rows[position.get(id)!]!)
  }
}
