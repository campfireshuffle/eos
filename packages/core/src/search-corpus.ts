/** A library like a real one for search tests: titles and Mermaid sources of every kind, the same on every call. */
import type { DiagramIndexRow } from "./types"

function rng(seed: number) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}
let r = rng(7)
const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!

const nouns =
  "user users account payment payments order orders invoice invoices cart checkout session token database cache queue worker service services server client api gateway email notification report reports dashboard admin customer customers product products inventory warehouse shipment shipping refund subscription plan billing webhook event events log logs metric metrics alert alerts deployment pipeline build release branch commit review ticket tickets support agent message messages channel thread file files upload download image storage bucket backup restore migration schema table index query queries search result results config settings profile password role permission permissions group team project task tasks sprint milestone roadmap feature flag experiment analytics funnel signup onboarding status statuses process processes address addresses class classes box boxes entry entries category categories".split(
    " "
  )
const verbs =
  "create creates creating created update updates updating updated delete deleting deleted send sends sending sent validate validating validated process processing processed fetch fetching fetched store storing stored retry retrying retried check checks checking checked load loading loaded save saving saved render rendering rendered parse parsing parsed handle handling handled approve approving approved reject rejecting rejected schedule scheduling scheduled".split(
    " "
  )
const adjs =
  "new old pending failed active expired valid invalid primary secondary public private internal external manual automatic daily weekly monthly".split(
    " "
  )
const titleHeads = [
  "Login flow",
  "Checkout flow",
  "Payment processing",
  "User onboarding",
  "Order lifecycle",
  "CI pipeline",
  "Deployment process",
  "Auth sequence",
  "Data model",
  "Billing system",
  "Inventory sync",
  "Notification service",
  "Search architecture",
  "Support tickets",
  "Refund handling",
  "Subscription states",
  "Webhook delivery",
  "Cache invalidation",
  "Backup strategy",
  "Migration plan",
  "API gateway",
  "Email campaigns",
  "Analytics funnel",
  "Release train",
  "Feature flags",
  "Role permissions",
  "Shipping workflow",
  "Report generation",
  "Session handling",
  "File uploads",
]
const titleTails = ["", "", " v2", " (draft)", " – overview", " for mobile", " notes", " detailed", " 2024", " old", " sketch", " revised"]
const special = [
  "Sign-up flow",
  "Sarah's onboarding",
  "Follow-up emails",
  "Check-in process",
  "Customer’s journey",
  "E-mail verification",
  "Opt-in consent",
  "Third-party integrations",
  "Résumé parser",
  "Café ordering",
  "Straße routing",
  "Мой план",
  "Привет мир схема",
  "東京タワーの夜景",
  "用户登录流程",
  "ログインの流れ",
  "재고 관리",
  "ระบบเข้าสู่ระบบ",
  "Password reset",
  "Two-factor auth",
  "Don't repeat yourself",
  "Rock'n'roll playlist",
  "Real-time sync",
  "Read-only replica",
  "Multi-tenant SaaS",
  "X-ray imaging",
  "T-shirt store",
  "Peer-to-peer network",
  "Kubernetes cluster",
  "PostgreSQL replication",
  "OAuth 2.0 handshake",
  "GraphQL resolvers",
  "Stripe webhooks",
  "Running jobs",
  "Shipped orders",
  "Embedded widgets",
  "Using Redis",
  "News feed ranking",
]
const kinds = ["flowchart", "sequence", "class", "er", "state", "gantt"]
function body(kind: string, n: number): string {
  const label = () => `${pick(verbs)} ${pick(adjs)} ${pick(nouns)}`.replace(/^./, (c) => c.toUpperCase())
  const lines: string[] = []
  if (kind === "flowchart") {
    lines.push("flowchart TD")
    for (let i = 0; i < n; i++) lines.push(`  N${i}[${label()}] --> N${i + 1}{${pick(nouns)}?}`)
  } else if (kind === "sequence") {
    lines.push("sequenceDiagram")
    const ps = ["Client", "Server", "DB", "Queue", "Worker", "Gateway"]
    for (let i = 0; i < n; i++) lines.push(`  ${pick(ps)}->>${pick(ps)}: ${label()}`)
  } else if (kind === "class") {
    lines.push("classDiagram")
    for (let i = 0; i < n; i++)
      lines.push(
        `  class ${pick(nouns).replace(/^./, (c) => c.toUpperCase())}${i} {\n    +${pick(verbs)}()\n    +${pick(nouns)}: string\n  }`
      )
  } else if (kind === "er") {
    lines.push("erDiagram")
    for (let i = 0; i < n; i++) lines.push(`  ${pick(nouns).toUpperCase()} ||--o{ ${pick(nouns).toUpperCase()} : "${pick(verbs)}"`)
  } else if (kind === "state") {
    lines.push("stateDiagram-v2")
    for (let i = 0; i < n; i++) lines.push(`  ${pick(adjs)} --> ${pick(adjs)}: ${label()}`)
  } else {
    lines.push("gantt", "  title Plan", "  dateFormat YYYY-MM-DD")
    for (let i = 0; i < n; i++) lines.push(`  ${label()} :t${i}, 2024-01-${String((i % 28) + 1).padStart(2, "0")}, 3d`)
  }
  return lines.join("\n")
}
/** `count` diagrams, a few dozen with titles that are hard to search (apostrophes, hyphens, accents, other scripts). */
export function library(count = 1000): DiagramIndexRow[] {
  r = rng(7)
  const rows: DiagramIndexRow[] = []
  for (let i = 0; i < count; i++) {
    const title = i < special.length ? special[i]! : pick(titleHeads) + pick(titleTails)
    const kind = pick(kinds)
    const n = 5 + Math.floor(r() * (r() < 0.1 ? 200 : 25))
    const src = body(kind, n)
    rows.push({ id: `d${i}`, title, sourceText: src, sourcePreview: src.slice(0, 200) } as unknown as DiagramIndexRow)
  }
  // Shuffled, so the hard titles aren't first in the library's order.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[rows[i], rows[j]] = [rows[j]!, rows[i]!]
  }
  return rows
}
