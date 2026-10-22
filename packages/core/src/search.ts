import MiniSearch, { type Query } from "minisearch"
import pluralize from "pluralize"

import type { DiagramIndexRow } from "./types"

/** Title matches count this many times more than contents matches. */
const TITLE_BOOST = 3
/** Rows indexed per task while building (about 10ms of work). */
const BUILD_SLICE = 100
/**
 * How much a prefix or typo match counts against the word itself, less the longer the rest of the term (see
 * searchIndex). A prefix weighs at least PREFIX_WEIGHT / 1.3, about 0.29, and a typo at most TYPO_WEIGHT, so a word
 * being typed ("deta") finds a title it starts ("… detailed") above one a typo away ("Data model").
 */
const PREFIX_WEIGHT = 0.375
const TYPO_WEIGHT = 0.25

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
 * "Привет" is one word, not fragments.
 */
function wordsIn(raw: string) {
  // Each distinct word once: a source repeats its words and arrows many times.
  const words = new Set(
    raw
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .split(/[^\p{L}\p{M}\p{N}_'-]+/u)
  )
  const split = [...words].flatMap((w) => (UNSPACED.test(w) ? segment(w) : [w]))
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

/** Drops the last letter of a doubled consonant: "runn" (from "running") is "run", "shipp" "ship"; "add" and "call" stay. */
const undouble = (w: string) => (w.length > 3 && /([^aeioulsz])\1$/.test(w) ? w.slice(0, -1) : w)
/**
 * The forms of an English word that count as the word whole, each as a term of its own: "~" and the word's
 * singular, from pluralize ("statuses" and "status" are both "~status", "policies" "~policy"), and for a word
 * ending in -ing or -ed the forms it may come from ("creating" is "~creat", "~create"; "running" "~runn",
 * "~run"). Only those endings: "experiment" isn't "experience", nor "organization" "organ". The "~"
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
  if (verb && /[aeiouy]/.test(verb[1]!)) {
    const stem = verb[1]!
    // A doubled consonant is undoubled ("shipp" to "ship"); otherwise an e may have been dropped ("creat").
    forms.add(stem).add(undouble(stem) === stem ? stem + "e" : undouble(stem))
  }
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
  // Each word as the index has it: itself, its parts and their forms. Kept per word, since a library repeats its words a lot.
  // The parts are terms of the word, not words of their own, so a hyphenated title isn't counted as longer: "sign"
  // finds "Sign-up flow" as it does "Sign up flow". A query's parts are searched apart from it (see below).
  const terms = new Map<string, string[]>()
  const indexTerms = (w: string) =>
    terms.get(w) ?? terms.set(w, [...new Set([w, ...partsOf(w), ...[w, ...partsOf(w)].flatMap(formsOf)])]).get(w)!
  const index = new MiniSearch<{ id: string; title: string; source: string }>({
    fields: ["title", "source"],
    tokenize: wordsIn,
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
  /** A term's score in each diagram that has it, title and contents apart, as MiniSearch scores the term whole. Kept while the index is: it doesn't change. */
  const scores = new Map<string, Map<string, [title: number, source: number]>>()
  const scoresOf = (term: string) => {
    let byId = scores.get(term)
    if (!byId) {
      scores.set(term, (byId = new Map()))
      for (const [i, field] of (["title", "source"] as const).entries())
        for (const r of index.search({ queries: [term], prefix: false, fuzzy: false }, { fields: [field] }))
          (byId.get(r.id) ?? byId.set(r.id, [0, 0]).get(r.id)!)[i] = r.score
    }
    return byId
  }
  return async (rows, query) => {
    const position = new Map(rows.map((r, i) => [r.id, i]))
    const words = wordsIn(query)
    // A typo is allowed per word: none in a word of a short-word script, one elsewhere once the query is over 3
    // characters. MiniSearch scores a prefix or typo match below the word itself.
    const typos = query.length > 3 ? 1 : 0
    const found = new Map<string, { score: number; words: number; typed: number; whole: number }>()
    // Each word is searched on its own, and scored by the best term it matches in each field: MiniSearch would add
    // up every term a prefix or typo stands for, so a big diagram with "payment52", "payment20" and "payments185"
    // would outrank a title starting with "pay", and a word searched as itself and its forms would count more than
    // "用户", "k8s" or "42", searched only as itself.
    for (const w of words) {
      const forms = formsOf(w)
      const queries: Query[] = [{ queries: [w], prefix: true, fuzzy: SHORT_WORDS.test(w) ? false : typos }]
      // The word's forms, only whole: "cookie" finds "Cookies", "query" "queries".
      if (forms.length > 0) queries.push({ queries: forms, prefix: false, fuzzy: false })
      // A hyphenated word's parts, all of them whole: "follow-up" finds "Follow up", and "check-in"
      // isn't "check" or "in" one typo away, nor "checkout" and "invoice" (prefixes).
      const parts = partsOf(w)
      if (parts.length > 0) queries.push({ queries: parts, combineWith: "AND", prefix: false, fuzzy: false })
      for (const r of index.search({ combineWith: "OR", queries })) {
        if (!position.has(r.id)) continue
        const f = found.get(r.id) ?? { score: 0, words: 0, typed: 0, whole: 0 }
        // The best title and contents score among the terms this diagram matched (MiniSearch reports them), each
        // weighted by how it matched: whole (the word or a form) 1, a prefix less, the longer the rest of
        // the term the less. The parts count together, as one term at half weight. A typo counts only in a diagram
        // that has none of those, as does the typed tier below.
        const typed = [0, 0]
        const typo = [0, 0]
        const take = (best: number[], weight: number, field: number[]) =>
          field.forEach((s, i) => (best[i] = Math.max(best[i]!, weight * s)))
        for (const t of r.terms) {
          if (parts.includes(t)) continue
          const scores = scoresOf(t).get(r.id)!
          if (t === w || forms.includes(t)) take(typed, 1, scores)
          else if (t.startsWith(w)) take(typed, (PREFIX_WEIGHT * t.length) / (t.length + 0.3 * (t.length - w.length)), scores)
          else take(typo, (TYPO_WEIGHT * t.length) / (t.length + 1), scores)
        }
        if (parts.length > 0 && parts.every((p) => r.terms.includes(p)))
          take(
            typed,
            0.5,
            [0, 1].map((i) => parts.reduce((sum, p) => sum + scoresOf(p).get(r.id)![i]!, 0))
          )
        const hasTyped = typed[0]! + typed[1]! > 0
        const [title, source] = hasTyped ? typed : typo
        f.score += TITLE_BOOST * title! + source!
        f.words++
        if (hasTyped) f.typed++
        // Whole: as the word itself or one of its forms (MiniSearch reports the terms that matched).
        if (r.terms.includes(w) || forms.some((t) => r.terms.includes(t))) f.whole++
        found.set(r.id, f)
      }
    }
    // A diagram ranks first by how many of the query's words it has whole, so a rare typo or prefix neighbour
    // ("logic", "420") never outranks the word itself ("login", "42"); then by how many it has without a typo, so a
    // word being typed ("revis") finds what it starts ("revised") above a rare word a typo away ("Redis"). Then by
    // score times how many of the words it has at all (as MiniSearch does per term), titles boosted; equal ones keep
    // the order the rows came in (the library's sort), not the index's.
    return [...found]
      .sort(
        ([a, x], [b, y]) =>
          y.whole - x.whole || y.typed - x.typed || y.score * y.words - x.score * x.words || position.get(a)! - position.get(b)!
      )
      .map(([id]) => rows[position.get(id)!]!)
  }
}
