/** Diagrams seeded into an empty library so the first visit isn't blank. */
export const SAMPLES: { title: string; source: string; tags: string[] }[] = [
  {
    title: "Request lifecycle",
    tags: ["work/backend"],
    source: `flowchart TD
  A([Mermaid text]) --> B{Supported?}
  B -- Yes --> C[Parse]
  B -- No --> H[Fall back]

  subgraph Pele
    C --> D[Layout]
    D --> E[Render]
  end

  E --> F[(SVG)]
  F -.-> G[Theme with CSS]
`,
  },
  {
    title: "Checkout sequence",
    tags: ["work/payments"],
    source: `sequenceDiagram
  participant U as User
  participant A as App
  participant P as Payments
  U->>A: Place order
  A->>P: Create charge
  P-->>A: Charge succeeded
  A-->>U: Order confirmed
`,
  },
  {
    title: "Q4 launch plan",
    tags: ["work"],
    source: `gantt
  title Q4 launch
  dateFormat YYYY-MM-DD
  section Build
    Data model     :a1, 2026-10-01, 14d
    Editor         :a2, after a1, 10d
  section Ship
    Beta           :b1, after a2, 7d
    Launch         :milestone, after b1, 0d
`,
  },
  {
    title: "Orders schema",
    tags: ["work/backend"],
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "ordered in"
`,
  },
  {
    title: "Traffic sources",
    tags: ["pele"],
    source: `pie title Traffic sources
  "Search" : 42
  "Direct" : 28
  "Social" : 18
  "Referral" : 12
`,
  },
  {
    title: "Eos roadmap",
    tags: ["ideas"],
    source: `mindmap
  root((Eos))
    Library
      Tags
      Stars
    Editor
      Undo history
      Export
    Agents
      WebMCP
`,
  },
]
