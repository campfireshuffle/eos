import { create, insertMultiple, search } from "@orama/orama"
import { describe, expect, it } from "vitest"

import { SAMPLES } from "./samples"
import { searchIndex } from "./search"
import type { DiagramIndexRow } from "./types"

const row = (id: string, title: string, source = "flowchart TD\n  A --> B\n") =>
  ({ id, title, sourceText: source, sourcePreview: "" }) as unknown as DiagramIndexRow

/** The titles `query` finds among diagrams with these titles. */
async function titlesFound(titles: string[], query: string) {
  const rows = titles.map((t, i) => row(`d${i}`, t))
  return (await (await searchIndex(rows))!(rows, query)).map((r) => r.title)
}

describe("search", () => {
  it("finds a diagram by a word in any script, and only that diagram", async () => {
    const titles = [
      "Схема входа",
      "Διάγραμμα ροής",
      "مخطط الدخول",
      "תרשים כניסה",
      "लॉगिन प्रवाह",
      "로그인 흐름",
      "東京 大阪",
      "ログインの流れ",
      "Straße plan",
      "Müller Kunden",
      "Niño flujo",
      "Plain login",
    ]
    const wrong: string[] = []
    for (const [query, title] of [
      ["схема", "Схема входа"],
      ["Διάγραμμα", "Διάγραμμα ροής"],
      ["مخطط", "مخطط الدخول"],
      ["תרשים", "תרשים כניסה"],
      ["लॉगिन", "लॉगिन प्रवाह"],
      ["로그인", "로그인 흐름"],
      ["東京", "東京 大阪"],
      ["ログイン", "ログインの流れ"],
      ["Straße", "Straße plan"],
      ["Müller", "Müller Kunden"],
      ["Niño", "Niño flujo"],
    ] as const) {
      const found = await titlesFound(titles, query)
      if (JSON.stringify(found) !== JSON.stringify([title])) wrong.push(`${query} → ${JSON.stringify(found)}`)
    }
    expect(wrong).toEqual([])
  })

  it("finds a word with or without its accents", async () => {
    expect(await titlesFound(["A naïve plan", "Other"], "naive")).toEqual(["A naïve plan"])
    expect(await titlesFound(["Résumé flow", "Other"], "resume")).toEqual(["Résumé flow"])
    expect(await titlesFound(["Café menu", "Other"], "cafe")).toEqual(["Café menu"])
  })

  it("finds the same English diagrams, in the same order, as Orama's own tokenizer", async () => {
    // A fixed pseudo-random corpus of English, the accents Orama's tokenizer handles, and Mermaid punctuation.
    let seed = 42
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const words = (
      "login flow user service database api gateway checkout cart payment order queue worker cache auth token " +
      "session retry error timeout résumé café déjà-vu don't it's A B C D E1 F_2 x-y 2024 v1.2 CamelCase snake_case " +
      "kebab-case --> -.-> ==> [Start] (End) {Decision} %% subgraph"
    ).split(" ")
    const text = (n: number) =>
      Array.from({ length: n }, () => words[Math.floor(random() * words.length)]).join(random() < 0.5 ? " " : "\n  ")
    const rows = Array.from({ length: 400 }, (_, i) => row(`d${i}`, text(3), "flowchart TD\n  " + text(30)))
    rows.push(...SAMPLES.map((s, i) => row(`s${i}`, s.title, s.source)))

    // searchIndex's query, over an index built with Orama's default tokenizer.
    const db = create({ schema: { id: "string", title: "string", source: "string" } as const })
    await insertMultiple(
      db,
      rows.map((r) => ({ id: r.id, title: r.title, source: r.sourceText! }))
    )
    const position = new Map(rows.map((r, i) => [r.id, i]))
    const before = async (query: string) => {
      const result = (await search(db, {
        term: query,
        properties: ["title", "source"],
        boost: { title: 3 },
        tolerance: query.length > 3 ? 1 : 0,
        limit: rows.length,
      })) as { hits: { score: number; document: { id: string } }[] }
      return result.hits
        .sort((a, b) => b.score - a.score || position.get(a.document.id)! - position.get(b.document.id)!)
        .map((h) => h.document.id)
    }
    const now = (await searchIndex(rows))!

    const queries = [
      ...words,
      ...["logn", "databse", "chek", "pay", "u", "ab", "café", "cafe", "resume", "Résumé", "dont", "don't", "kebab"],
      ...["case", "snake", "1.2", "v1", "login flow", "user api", "start", "end", "decision", "A --> B", "sub", "xy"],
      ...["x-y", "e1", "f_2", "2024", "CAFÉ"],
    ]
    const differing: string[] = []
    for (const query of queries) {
      const expected = await before(query)
      const got = (await now(rows, query)).map((r) => r.id)
      if (JSON.stringify(got) !== JSON.stringify(expected)) differing.push(`${query}: ${expected.length} → ${got.length}`)
    }
    expect(differing).toEqual([])
  })
})
