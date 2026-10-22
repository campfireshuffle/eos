import { create, insertMultiple, search } from "@orama/orama"
import { describe, expect, it, vi } from "vitest"

import { SAMPLES } from "./samples"
import { searchIndex } from "./search"
import { library } from "./search-corpus"
import type { DiagramIndexRow } from "./types"

const row = (id: string, title: string, source = "flowchart TD\n  A --> B\n") =>
  ({ id, title, sourceText: source, sourcePreview: "" }) as unknown as DiagramIndexRow

/** The titles `query` finds among diagrams with these titles. */
async function titlesFound(titles: string[], query: string) {
  const rows = titles.map((t, i) => row(`d${i}`, t))
  return (await (await searchIndex(rows))!(rows, query)).map((r) => r.title)
}

/** 1000 diagrams with titles and contents of common words, the same on every call. */
function seeded() {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const vocabulary = (
    "login checkout payment auth queue worker cache session order api gateway user report invoice sarah sign " +
    "dashboard flow sprint service database"
  ).split(" ")
  const pick = () => vocabulary[Math.floor(random() * vocabulary.length)]!
  return Array.from({ length: 1000 }, (_, i) => {
    const lines = ["flowchart TD", ...Array.from({ length: 8 }, (_, j) => `  N${j}[${pick()} ${pick()}] --> N${j + 1}[${pick()}]`)]
    return row(`d${i}`, `${pick()} ${pick()} ${i}`, lines.join("\n"))
  })
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
    // The seeded library, plus the diagrams each query targets.
    const rows = seeded()
    rows.push(row("logic", "Logic flow"), row("login", "Login flow"), row("v3", "Auth v3"), row("v2", "Auth v2"))
    rows.push(...Array.from({ length: 100 }, (_, i) => row(`s${i + 1}`, `Sprint ${i + 1} retro`)))
    rows.push(row("payov", "Payments overview"), row("sarahs", "Sarah's onboarding"), row("signup", "Sign-up flow"))
    rows.push(row("dont", "Don\u2019t ship on Friday"), row("followup", "Follow up"), row("checkin", "Check in desk"))
    // Each exact word next to a longer word a full stemmer takes to it.
    rows.push(row("organ", "Organ donor matching"), row("organization", "Organization chart"))
    rows.push(row("us", "US region failover"), row("use", "Use cases"), row("using", "Using queues"))
    rows.push(row("author", "Author workflow"), row("authorization", "Authorization flow"))
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
      // Some seeded titles have payment whole ("payment payment 58"), so any of those may be #1.
      ["payment", "#1 has payment or payments whole in its title", (r) => /\bpayments?\b/i.test(title(r[0]!))],
      [
        "payment",
        "Payments overview above every title without payment or payments",
        (r) => before(r, "payov", (id) => !/\bpayments?\b/i.test(title(id))),
      ],
      // About 40 diagrams have "sarah" in their contents.
      ["sarah", "Sarah's onboarding #1", (r) => r[0] === "sarahs"],
      ["sign", "Sign-up flow #1", (r) => r[0] === "signup"],
      ["don't", "Don\u2019t ship on Friday #1", (r) => r[0] === "dont"],
      ["don't", "not every diagram (through t)", (r) => r.length < rows.length],
      ["follow-up", "finds Follow up", (r) => r.includes("followup")],
      ["billingpage", "Billingpage-->Home above Billingpagex", (r) => before(r, "arrow", (id) => id === "billpre")],
      ["organ", "Organ donor matching #1", (r) => r[0] === "organ"],
      ["us", "US region failover #1", (r) => r[0] === "us"],
      ["author", "Author workflow #1", (r) => r[0] === "author"],
      // No other diagram has "check" and "in" whole: the parts take no typo, and prefixes ("checkout") don't count.
      ["check-in", "only Check in desk", (r) => JSON.stringify(r) === JSON.stringify(["checkin"])],
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
      // From the first prefix no other title's word shares: "pa" is as much "path" (Happy path) as "payments".
      const others = titles.filter((_, j) => j !== i).flatMap((t) => t.toLowerCase().split(/[^a-z]+/))
      let n = 2
      while (others.some((w) => w.startsWith(word.slice(0, n)))) n++
      for (; n <= word.length; n++) {
        const query = word.slice(0, n)
        const first = (await find(rows, query))[0]?.title
        if (first !== titles[i]) misses.push(`${query} → ${first}`)
      }
    }
    expect(misses).toEqual([])
  })

  for (const [corpus, make] of [
    ["the seeded library", seeded],
    ["a realistic library", () => library(1000)],
  ] as const)
    it(`ranks plurals, word endings and hyphenated words by expected positions in ${corpus} of 1000`, async () => {
      const rows = make()
      const add = (id: string, title: string, source = "flowchart TD\n  A[Start] --> B[End]") => rows.push(row(id, title, source))
      // Plurals of acronyms and of words ending in -y, with 40 diagrams that have the singular in their contents.
      add("cookies", "Cookies and sessions")
      add("apis", "Partner APIs")
      add("ids", "User IDs")
      add("dbs", "Shard DBs")
      add("prs", "Open PRs")
      add("kpis", "Team KPIs")
      for (let i = 0; i < 40; i++) add(`x${i}`, `Service ${i}`, "flowchart TD\n  A[api call] --> B[cookie id db pr kpi]")
      // A hyphenated word in the contents, next to titles with one of its parts or a longer word.
      add("auth", "Website auth", "flowchart LR\n  A[Home] --> B[Sign-in page] --> C[Account]")
      for (const t of ["Sign contract", "E-signature", "Code signing", "Sign out"])
        add(`sg ${t}`, t, `flowchart TD\n  A[Start] --> B[${t}] --> C[Stored in S3]`)
      add("hotel", "Hotel stay", "flowchart TD\n  A[Booking] --> B[Guest check-in at front desk] --> C[Room]")
      for (const t of ["Health checks", "CI checks", "Credit check", "Stock check"])
        add(`ck ${t}`, t, `flowchart TD\n  A[Request comes in] --> B{${t}?}`)
      // Other word endings, and words one letter apart.
      add("ent", "Entities")
      add("qry", "Database queries")
      add("crt", "Creating an account")
      add("pol", "Access policies")
      add("mng", "Managing users")
      add("stats", "Stats dashboard")
      add("states", "States of an order")
      add("heading", "Heading styles")
      add("head", "Head office")
      rows.reverse()
      const find = (await searchIndex(rows))!
      const title = (id: string) => rows.find((r) => r.id === id)!.title
      /** Whether `id` is found, and above every other result `other` holds for. */
      const above = (r: string[], id: string, other: (id: string) => boolean) => {
        const next = r.findIndex((x) => x !== id && other(x))
        return r.includes(id) && (next < 0 || r.indexOf(id) < next)
      }
      const first = (id: string) => (r: string[]) => r[0] === id
      const matrix: [string, string, (r: string[]) => boolean][] = [
        ["cookie", "Cookies and sessions #1", first("cookies")],
        ["api", "Partner APIs above every title without api or apis", (r) => above(r, "apis", (x) => !/\bapis?\b/i.test(title(x)))],
        ["id", "User IDs #1", first("ids")],
        ["db", "Shard DBs #1", first("dbs")],
        ["pr", "Open PRs #1", first("prs")],
        ["kpi", "Team KPIs #1", first("kpis")],
        [
          "sign-in",
          "Website auth above Code signing, Sign contract, Sign out and E-signature",
          (r) => above(r, "auth", (x) => x.startsWith("sg ")),
        ],
        ["check-in", "Hotel stay above every check(s) title", (r) => above(r, "hotel", (x) => x.startsWith("ck "))],
        ["entity", "Entities #1", first("ent")],
        ["query", "Database queries #1", first("qry")],
        ["create", "Creating an account #1", first("crt")],
        ["policy", "Access policies #1", first("pol")],
        ["manage", "Managing users #1", first("mng")],
        ["stats", "Stats dashboard #1", first("stats")],
        ["stats", "States of an order below Stats dashboard", (r) => !r.includes("states") || above(r, "stats", (x) => x === "states")],
        [
          "states",
          "Stats dashboard below every title with states",
          (r) => !r.includes("stats") || r.indexOf("stats") > r.findLastIndex((x) => /\bstates\b/i.test(title(x))),
        ],
        ["heading", "Heading styles #1", first("heading")],
        ["head", "Head office #1", first("head")],
      ]
      const failing: string[] = []
      for (const [query, expected, holds] of matrix) {
        const r = (await find(rows, query)).map((x) => x.id)
        if (!holds(r)) failing.push(`${query}: ${expected} (got ${r.slice(0, 3).map(title).join(" | ")})`)
      }
      expect(failing).toEqual([])
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
