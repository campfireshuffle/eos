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
    // "登录 logout flow" has one of the words whole, "login page" only a typo of one.
    expect(await titlesFound(["登录 login flow", "登录 logout flow", "login page"], "登录 logn")).toEqual([
      "登录 login flow",
      "登录 logout flow",
      "login page",
    ])
    expect(await titlesFound(["API 接口 gateway", "Payment 接口"], "gatway 接口")).toEqual(["API 接口 gateway", "Payment 接口"])
    expect(await titlesFound(["Checkout 流程", "Checkout page", "Order 流程"], "chekout 流程")).toEqual([
      "Checkout 流程",
      "Order 流程",
      "Checkout page",
    ])
  })

  it("ranks by expected positions in a library of 1000", async () => {
    // A seeded library: 1000 diagrams with titles and contents of common words, plus the diagrams each query targets.
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const vocabulary = (
      "login checkout payment auth queue worker cache session order api gateway user report invoice sarah sign " +
      "dashboard flow sprint service database"
    ).split(" ")
    const pick = () => vocabulary[Math.floor(random() * vocabulary.length)]!
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const lines = ["flowchart TD", ...Array.from({ length: 8 }, (_, j) => `  N${j}[${pick()} ${pick()}] --> N${j + 1}[${pick()}]`)]
      return row(`d${i}`, `${pick()} ${pick()} ${i}`, lines.join("\n"))
    })
    rows.push(row("logic", "Logic flow"), row("login", "Login flow"), row("v3", "Auth v3"), row("v2", "Auth v2"))
    rows.push(...Array.from({ length: 100 }, (_, i) => row(`s${i + 1}`, `Sprint ${i + 1} retro`)))
    rows.push(row("payov", "Payments overview"), row("sarahs", "Sarah's onboarding"), row("signup", "Sign-up flow"))
    rows.push(row("dont", "Don\u2019t ship on Friday"), row("followup", "Follow up"))
    rows.push(
      row("arrow", "Routing", "flowchart LR\n  Billingpage-->Home\n"),
      row("billpre", "Billingpagex index", "flowchart LR\n  X --> Y\n")
    )
    // The library's order is newest first, so a tie can't pass by insertion order.
    rows.reverse()
    const find = (await searchIndex(rows))!
    const ids = async (query: string) => (await find(rows, query)).map((r) => r.id)
    const title = (id: string) => rows.find((r) => r.id === id)!.title
    const text = (id: string) => `${title(id)} ${rows.find((r) => r.id === id)!.sourceText}`

    const loginWhole = /\blogin\b/i
    const before = (r: string[], id: string, other: (id: string) => boolean) => r.includes(id) && r.indexOf(id) < r.findIndex(other)
    // Each query, what its results must be, written from the data above.
    const matrix: [string, string, (r: string[]) => boolean][] = [
      ["login", "#1 has login whole in its title", (r) => loginWhole.test(title(r[0]!))],
      ["login", "Login flow above every title without login", (r) => before(r, "login", (id) => !loginWhole.test(title(id)))],
      [
        "login",
        "Logic flow below every diagram with login whole",
        (r) => r.indexOf("logic") > r.findLastIndex((id) => loginWhole.test(text(id))),
      ],
      ["sprint 42", "Sprint 42 retro #1, not 420", (r) => r[0] === "s42"],
      ["auth v2", "Auth v2 #1", (r) => r[0] === "v2"],
      ["login flow", "Login flow #1", (r) => r[0] === "login"],
      // No other title has payment or payments, so this is #1.
      ["payment", "Payments overview #1", (r) => r[0] === "payov"],
      // About 40 diagrams have "sarah" in their contents.
      ["sarah", "Sarah's onboarding #1", (r) => r[0] === "sarahs"],
      ["sign", "Sign-up flow #1", (r) => r[0] === "signup"],
      ["don't", "Don\u2019t ship on Friday #1", (r) => r[0] === "dont"],
      ["don't", "not every diagram (through t)", (r) => r.length < rows.length],
      ["follow-up", "finds Follow up", (r) => r.includes("followup")],
      ["billingpage", "Billingpage-->Home above Billingpagex", (r) => before(r, "arrow", (id) => id === "billpre")],
      ["chekout", "a typo finds only checkout diagrams", (r) => r.length > 0 && r.every((id) => /checkout/i.test(text(id)))],
    ]
    const failing: string[] = []
    for (const [query, expected, holds] of matrix) if (!holds(await ids(query))) failing.push(`${query}: ${expected}`)
    expect(failing).toEqual([])
  })

  it("ranks a title first that has the plural or singular of the query", async () => {
    const topics = ["checkout", "auth", "orders", "inventory", "shipping", "billing", "search", "notifications", "analytics", "onboarding"]
    const rows = Array.from({ length: 300 }, (_, i) => {
      const t = topics[i % 10]!
      const source = [
        "flowchart LR",
        `  A[${t} service] --> B[Gateway]`,
        i % 8 === 0 ? "  B --> P[Payments API]" : "  B --> D[Database]",
        i % 9 === 0 ? "  D --> U[Users table]" : "  D --> C[Cache]",
      ].join("\n")
      return row(`d${i}`, `${t[0]!.toUpperCase() + t.slice(1)} ${i}`, source)
    })
    rows.push(row("pay", "Payment flow", "flowchart LR\n  Cart --> Charge --> Receipt"))
    rows.push(row("user", "User signup", "flowchart LR\n  Form --> Verify --> Done"))
    rows.push(row("inv", "Invoices", "flowchart LR\n  Bill --> Send"))
    const find = (await searchIndex(rows))!
    const first = async (query: string) => (await find(rows, query))[0]?.id
    expect(await first("payments")).toBe("pay")
    expect(await first("payment")).toBe("pay")
    expect(await first("users")).toBe("user")
    expect(await first("invoice")).toBe("inv")
  })

  it("ranks the title first at every prefix typed so far", async () => {
    const titles = ["Payments overview", "Configuration guide", "Happy path", "Sarah's onboarding", "Sign-up flow", "Database migrations"]
    const rows = titles.map((t, i) => row(`d${i}`, t, "flowchart TD\n  X --> Y\n"))
    const find = (await searchIndex(rows))!
    const misses: string[] = []
    for (const [i, word] of ["payments", "configuration", "happy", "sarah's", "sign-up", "migrations"].entries()) {
      for (let n = 2; n <= word.length; n++) {
        const query = word.slice(0, n)
        const first = (await find(rows, query))[0]?.title
        if (first !== titles[i]) misses.push(`${query} → ${first}`)
      }
    }
    expect(misses).toEqual([])
  })

  it("finds a word with or without its accents", async () => {
    expect(await titlesFound(["A naïve plan", "Other"], "naive")).toEqual(["A naïve plan"])
    expect(await titlesFound(["Résumé flow", "Other"], "resume")).toEqual(["Résumé flow"])
    expect(await titlesFound(["Café menu", "Other"], "cafe")).toEqual(["Café menu"])
  })

  it("finds every diagram Orama's own tokenizer finds", async () => {
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

    const db = create({ schema: { id: "string", title: "string", source: "string" } as const })
    await insertMultiple(
      db,
      rows.map((r) => ({ id: r.id, title: r.title, source: r.sourceText! }))
    )
    const orama = async (query: string) =>
      (
        (await search(db, {
          term: query,
          properties: ["title", "source"],
          tolerance: query.length > 3 ? 1 : 0,
          limit: rows.length,
        })) as { hits: { document: { id: string } }[] }
      ).hits.map((h) => h.document.id)
    const eos = (await searchIndex(rows))!

    const queries = [
      ...words,
      ...["logn", "databse", "chek", "pay", "ab", "café", "cafe", "resume", "Résumé", "dont", "don't", "kebab"],
      ...["case", "snake", "1.2", "v1", "login flow", "user api", "start", "end", "decision", "A --> B", "sub", "xy"],
      ...["x-y", "e1", "f_2", "2024", "CAFÉ"],
    ]
    const missing: string[] = []
    for (const query of queries) {
      const found = new Set((await eos(rows, query)).map((r) => r.id))
      const lost = (await orama(query)).filter((id) => !found.has(id))
      if (lost.length > 0) missing.push(`${query}: ${lost.length}`)
    }
    expect(missing).toEqual([])
  })
})
