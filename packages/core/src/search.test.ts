import { create, insertMultiple, search } from "@orama/orama"
import { describe, expect, it, vi } from "vitest"

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

  it("finds a word inside a run of an unspaced script", async () => {
    const titles = ["東京大阪", "ログインの流れ", "用户登录流程", "ระบบเข้าสู่ระบบ", "Plain login"]
    expect(await titlesFound(titles, "大阪")).toEqual(["東京大阪"])
    expect(await titlesFound(titles, "流れ")).toEqual(["ログインの流れ"])
    expect(await titlesFound(titles, "登录")).toEqual(["用户登录流程"])
    expect(await titlesFound(titles, "เข้าสู่")).toEqual(["ระบบเข้าสู่ระบบ"])
  })

  it("finds a run that is one word where the segmenter doesn't mark it as a word, as Firefox's doesn't", async () => {
    vi.resetModules()
    const Segmenter = Intl.Segmenter
    vi.stubGlobal("Intl", {
      ...Intl,
      Segmenter: class extends Segmenter {
        segment(input: string) {
          return [...super.segment(input)].map((s) => ({ ...s, isWordLike: false })) as unknown as Intl.Segments
        }
      },
    })
    try {
      const { searchIndex: firefoxIndex } = await import("./search")
      const rows = ["東京", "日本語", "ภาษาไทย", "Plain login"].map((t, i) => row(`d${i}`, t))
      const found = async (query: string) => (await (await firefoxIndex(rows))!(rows, query)).map((r) => r.title)
      expect(await found("東京")).toEqual(["東京"])
      expect(await found("日本語")).toEqual(["日本語"])
      expect(await found("ไทย")).toEqual(["ภาษาไทย"])
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it("allows no typo in words of a few characters: Chinese, Japanese, Korean", async () => {
    const japanese = ["ログインの流れ", "注文の処理", "在庫の管理", "請求書作成", "社員研修計画"]
    expect(await titlesFound(japanese, "請求書作成")).toEqual(["請求書作成"])
    expect(await titlesFound(japanese, "在庫管理")).toEqual(["在庫の管理"])
    expect(await titlesFound(["北京地图", "南京旅游"], "北京地图")).toEqual(["北京地图"])
    expect(await titlesFound(["재고 관리", "주문 처리"], "재고 관리")).toEqual(["재고 관리"])
  })

  it("allows a typo in the other words of a query that also holds Chinese", async () => {
    expect(await titlesFound(["登录 login flow", "登录 logout flow", "login page"], "登录 logn")).toEqual([
      "登录 login flow",
      "login page",
      "登录 logout flow",
    ])
    expect(await titlesFound(["API 接口 gateway", "Payment 接口"], "gatway 接口")).toEqual(["API 接口 gateway", "Payment 接口"])
    expect(await titlesFound(["Checkout 流程", "Checkout page", "Order 流程"], "chekout 流程")).toEqual([
      "Checkout 流程",
      "Checkout page",
      "Order 流程",
    ])
  })

  it("ranks the exact title above titles a typo away", async () => {
    const titles = [...Array.from({ length: 100 }, (_, i) => `Sprint ${i + 1} retro`), "Logic flow", "Login flow", "Auth v3", "Auth v2"]
    expect((await titlesFound(titles, "sprint 42"))[0]).toBe("Sprint 42 retro")
    expect((await titlesFound(titles, "login"))[0]).toBe("Login flow")
    expect((await titlesFound(titles, "auth v2"))[0]).toBe("Auth v2")
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

    // searchIndex's query (a typo-tolerant pass plus an exact one, scores added), over an index built with Orama's default tokenizer.
    const db = create({ schema: { id: "string", title: "string", source: "string" } as const })
    await insertMultiple(
      db,
      rows.map((r) => ({ id: r.id, title: r.title, source: r.sourceText! }))
    )
    const position = new Map(rows.map((r, i) => [r.id, i]))
    const find = async (term: string, tolerance: number) =>
      (
        (await search(db, { term, properties: ["title", "source"], boost: { title: 3 }, tolerance, limit: rows.length })) as {
          hits: { score: number; document: { id: string } }[]
        }
      ).hits
    const before = async (query: string) => {
      const hits = [...(await find(query, query.length > 3 ? 1 : 0)), ...(query.length > 3 ? await find(query, 0) : [])]
      const score = new Map<string, number>()
      for (const h of hits) score.set(h.document.id, (score.get(h.document.id) ?? 0) + h.score)
      return [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || position.get(a)! - position.get(b)!)
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
